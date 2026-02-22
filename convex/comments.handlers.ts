import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { assertAdmin, assertModerator, requireUser } from './lib/access'
import { insertStatEvent } from './skillStatEvents'

const MAX_ACTIVE_REPORTS_PER_USER = 20
const AUTO_HIDE_REPORT_THRESHOLD = 3
const MAX_LIST_BULK_LIMIT = 200
const MAX_LIST_TAKE = 1000
const MAX_REPORT_REASON_SAMPLE = 5

type CommentStatus = 'active' | 'hidden' | 'removed'

function clampInt(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function getCommentStatus(comment: Pick<Doc<'comments'>, 'moderationStatus' | 'softDeletedAt'>): CommentStatus {
  if (comment.moderationStatus) return comment.moderationStatus
  return comment.softDeletedAt ? 'hidden' : 'active'
}

export function isCommentVisible(
  comment: Pick<Doc<'comments'>, 'moderationStatus' | 'softDeletedAt'>,
) {
  return !comment.softDeletedAt && getCommentStatus(comment) === 'active'
}

export async function addHandler(ctx: MutationCtx, args: { skillId: Id<'skills'>; body: string }) {
  const { userId } = await requireUser(ctx)
  const body = args.body.trim()
  if (!body) throw new Error('Comment body required')

  const skill = await ctx.db.get(args.skillId)
  if (!skill) throw new Error('Skill not found')

  await ctx.db.insert('comments', {
    skillId: args.skillId,
    userId,
    body,
    createdAt: Date.now(),
    softDeletedAt: undefined,
    deletedBy: undefined,
    moderationStatus: 'active',
    moderationReason: undefined,
    moderationNotes: undefined,
    reportCount: 0,
    lastReportedAt: undefined,
    hiddenAt: undefined,
    lastReviewedAt: undefined,
  })

  await insertStatEvent(ctx, { skillId: skill._id, kind: 'comment' })
}

export async function removeHandler(ctx: MutationCtx, args: { commentId: Id<'comments'> }) {
  const { user } = await requireUser(ctx)
  const comment = await ctx.db.get(args.commentId)
  if (!comment) throw new Error('Comment not found')
  if (!isCommentVisible(comment)) return

  const isOwner = comment.userId === user._id
  if (!isOwner) {
    assertModerator(user)
  }

  const now = Date.now()
  await ctx.db.patch(comment._id, {
    softDeletedAt: now,
    deletedBy: user._id,
    moderationStatus: 'removed',
    moderationReason: isOwner ? 'manual.user_delete' : 'manual.moderator_delete',
    moderationNotes: undefined,
    lastReviewedAt: now,
  })

  await insertStatEvent(ctx, { skillId: comment.skillId, kind: 'uncomment' })

  await ctx.db.insert('auditLogs', {
    actorUserId: user._id,
    action: 'comment.delete',
    targetType: 'comment',
    targetId: comment._id,
    metadata: { skillId: comment.skillId },
    createdAt: now,
  })
}

async function countActiveReportsForUser(ctx: MutationCtx, userId: Id<'users'>) {
  const reports = await ctx.db
    .query('commentReports')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()

  let count = 0
  for (const report of reports) {
    const comment = await ctx.db.get(report.commentId)
    if (!comment) continue
    if (!isCommentVisible(comment)) continue
    const owner = await ctx.db.get(comment.userId)
    if (!owner || owner.deletedAt || owner.deactivatedAt) continue
    count += 1
    if (count >= MAX_ACTIVE_REPORTS_PER_USER) break
  }

  return count
}

export async function reportHandler(
  ctx: MutationCtx,
  args: { commentId: Id<'comments'>; reason: string },
) {
  const { userId } = await requireUser(ctx)
  const comment = await ctx.db.get(args.commentId)
  if (!comment || getCommentStatus(comment) === 'removed') {
    throw new Error('Comment not found')
  }
  if (!isCommentVisible(comment)) {
    throw new Error('Comment is already hidden.')
  }

  const reason = args.reason.trim()
  if (!reason) {
    throw new Error('Report reason required.')
  }

  const existing = await ctx.db
    .query('commentReports')
    .withIndex('by_comment_user', (q) => q.eq('commentId', args.commentId).eq('userId', userId))
    .unique()
  if (existing) return { ok: true as const, reported: false, alreadyReported: true }

  const activeReports = await countActiveReportsForUser(ctx, userId)
  if (activeReports >= MAX_ACTIVE_REPORTS_PER_USER) {
    throw new Error('Report limit reached. Please wait for moderation before reporting more.')
  }

  const now = Date.now()
  await ctx.db.insert('commentReports', {
    commentId: args.commentId,
    skillId: comment.skillId,
    userId,
    reason: reason.slice(0, 500),
    createdAt: now,
  })

  const nextReportCount = (comment.reportCount ?? 0) + 1
  const shouldAutoHide = nextReportCount > AUTO_HIDE_REPORT_THRESHOLD && isCommentVisible(comment)
  const updates: Partial<Doc<'comments'>> = {
    reportCount: nextReportCount,
    lastReportedAt: now,
  }
  if (shouldAutoHide) {
    Object.assign(updates, {
      softDeletedAt: now,
      moderationStatus: 'hidden',
      moderationReason: 'auto.reports',
      moderationNotes: 'Auto-hidden after 4 unique reports.',
      hiddenAt: now,
      lastReviewedAt: now,
      deletedBy: undefined,
    })
  }

  await ctx.db.patch(comment._id, updates)

  if (shouldAutoHide) {
    await insertStatEvent(ctx, { skillId: comment.skillId, kind: 'uncomment' })
    await ctx.db.insert('auditLogs', {
      actorUserId: userId,
      action: 'comment.auto_hide',
      targetType: 'comment',
      targetId: comment._id,
      metadata: { skillId: comment.skillId, reportCount: nextReportCount },
      createdAt: now,
    })
  }

  return { ok: true as const, reported: true, alreadyReported: false }
}

export async function setSoftDeletedHandler(
  ctx: MutationCtx,
  args: { commentId: Id<'comments'>; deleted: boolean },
) {
  const { user } = await requireUser(ctx)
  assertModerator(user)
  const comment = await ctx.db.get(args.commentId)
  if (!comment) throw new Error('Comment not found')

  const beforeVisible = isCommentVisible(comment)
  const now = Date.now()
  const patch: Partial<Doc<'comments'>> = args.deleted
    ? {
        softDeletedAt: now,
        deletedBy: user._id,
        moderationStatus: 'hidden',
        moderationReason: 'manual.moderation',
        moderationNotes: 'Hidden by moderator.',
        hiddenAt: now,
        lastReviewedAt: now,
      }
    : {
        softDeletedAt: undefined,
        deletedBy: undefined,
        moderationStatus: 'active',
        moderationReason: undefined,
        moderationNotes: undefined,
        hiddenAt: undefined,
        lastReviewedAt: now,
      }
  const afterVisible = !args.deleted
  await ctx.db.patch(comment._id, patch)

  if (beforeVisible && !afterVisible) {
    await insertStatEvent(ctx, { skillId: comment.skillId, kind: 'uncomment' })
  } else if (!beforeVisible && afterVisible) {
    await insertStatEvent(ctx, { skillId: comment.skillId, kind: 'comment' })
  }

  await ctx.db.insert('auditLogs', {
    actorUserId: user._id,
    action: args.deleted ? 'comment.hide' : 'comment.restore',
    targetType: 'comment',
    targetId: comment._id,
    metadata: { skillId: comment.skillId },
    createdAt: now,
  })
}

export async function hardDeleteHandler(ctx: MutationCtx, args: { commentId: Id<'comments'> }) {
  const { user } = await requireUser(ctx)
  assertAdmin(user)
  const comment = await ctx.db.get(args.commentId)
  if (!comment) return { deleted: false as const }

  const beforeVisible = isCommentVisible(comment)
  const reports = await ctx.db
    .query('commentReports')
    .withIndex('by_comment', (q) => q.eq('commentId', comment._id))
    .collect()
  for (const report of reports) {
    await ctx.db.delete(report._id)
  }
  await ctx.db.delete(comment._id)

  if (beforeVisible) {
    await insertStatEvent(ctx, { skillId: comment.skillId, kind: 'uncomment' })
  }

  await ctx.db.insert('auditLogs', {
    actorUserId: user._id,
    action: 'comment.hard_delete',
    targetType: 'comment',
    targetId: comment._id,
    metadata: { skillId: comment.skillId, reportCount: reports.length },
    createdAt: Date.now(),
  })

  return { deleted: true as const }
}

export async function listReportedCommentsHandler(ctx: QueryCtx, args: { limit?: number }) {
  const { user } = await requireUser(ctx)
  assertModerator(user)

  const limit = clampInt(args.limit ?? 25, 1, MAX_LIST_BULK_LIMIT)
  const takeLimit = Math.min(limit * 5, MAX_LIST_TAKE)
  const entries = await ctx.db.query('comments').order('desc').take(takeLimit)
  const reported = entries
    .filter((comment) => (comment.reportCount ?? 0) > 0)
    .sort((a, b) => (b.lastReportedAt ?? 0) - (a.lastReportedAt ?? 0))
    .slice(0, limit)

  const reporterCache = new Map<Id<'users'>, Promise<Doc<'users'> | null>>()
  const getReporter = (reporterId: Id<'users'>) => {
    const cached = reporterCache.get(reporterId)
    if (cached) return cached
    const reporterPromise = ctx.db.get(reporterId)
    reporterCache.set(reporterId, reporterPromise)
    return reporterPromise
  }

  return Promise.all(
    reported.map(async (comment) => {
      const [skill, commenter] = await Promise.all([
        ctx.db.get(comment.skillId),
        ctx.db.get(comment.userId),
      ])
      const owner = skill ? await ctx.db.get(skill.ownerUserId) : null
      const reports = await ctx.db
        .query('commentReports')
        .withIndex('by_comment_createdAt', (q) => q.eq('commentId', comment._id))
        .order('desc')
        .take(MAX_REPORT_REASON_SAMPLE)
      const reportEntries = await Promise.all(
        reports.map(async (report) => {
          const reporter = await getReporter(report.userId)
          const reason = report.reason?.trim()
          return {
            reason: reason && reason.length > 0 ? reason : 'No reason provided.',
            createdAt: report.createdAt,
            reporterHandle: reporter?.handle ?? reporter?.name ?? null,
            reporterId: report.userId,
          }
        }),
      )

      return {
        comment,
        skill,
        owner,
        commenter,
        reports: reportEntries,
      }
    }),
  )
}
