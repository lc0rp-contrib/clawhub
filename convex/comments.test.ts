/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lib/access', () => ({
  assertAdmin: vi.fn(),
  assertModerator: vi.fn(),
  requireUser: vi.fn(),
}))

vi.mock('./skillStatEvents', () => ({
  insertStatEvent: vi.fn(),
}))

const { requireUser, assertAdmin, assertModerator } = await import('./lib/access')
const { insertStatEvent } = await import('./skillStatEvents')
const {
  addHandler,
  hardDeleteHandler,
  removeHandler,
  reportHandler,
  setSoftDeletedHandler,
} = await import('./comments.handlers')

describe('comments mutations', () => {
  afterEach(() => {
    vi.mocked(assertAdmin).mockReset()
    vi.mocked(assertModerator).mockReset()
    vi.mocked(requireUser).mockReset()
    vi.mocked(insertStatEvent).mockReset()
  })

  it('add avoids direct skill patch and records stat event', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:1',
      user: { _id: 'users:1', role: 'user' },
    } as never)

    const get = vi.fn().mockResolvedValue({
      _id: 'skills:1',
    })
    const insert = vi.fn()
    const patch = vi.fn()
    const ctx = { db: { get, insert, patch } } as never

    await addHandler(ctx, { skillId: 'skills:1', body: ' hello ' } as never)

    expect(patch).not.toHaveBeenCalled()
    expect(insertStatEvent).toHaveBeenCalledWith(ctx, {
      skillId: 'skills:1',
      kind: 'comment',
    })
  })

  it('remove keeps comment soft-delete patch free of updatedAt', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:2',
      user: { _id: 'users:2', role: 'moderator' },
    } as never)

    const comment = {
      _id: 'comments:1',
      skillId: 'skills:1',
      userId: 'users:2',
      softDeletedAt: undefined,
    }
    const get = vi.fn(async (id: string) => {
      if (id === 'comments:1') return comment
      return null
    })
    const insert = vi.fn()
    const patch = vi.fn()
    const ctx = { db: { get, insert, patch } } as never

    await removeHandler(ctx, { commentId: 'comments:1' } as never)

    expect(patch).toHaveBeenCalledTimes(1)
    const deletePatch = vi.mocked(patch).mock.calls[0]?.[1] as Record<string, unknown>
    expect(deletePatch.updatedAt).toBeUndefined()
    expect(deletePatch.moderationStatus).toBe('removed')
    expect(insertStatEvent).toHaveBeenCalledWith(ctx, {
      skillId: 'skills:1',
      kind: 'uncomment',
    })
  })

  it('remove rejects non-owner without moderator permission', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:3',
      user: { _id: 'users:3', role: 'user' },
    } as never)
    vi.mocked(assertModerator).mockImplementation(() => {
      throw new Error('Moderator role required')
    })

    const comment = {
      _id: 'comments:2',
      skillId: 'skills:2',
      userId: 'users:9',
      softDeletedAt: undefined,
    }
    const get = vi.fn().mockResolvedValue(comment)
    const insert = vi.fn()
    const patch = vi.fn()
    const ctx = { db: { get, insert, patch } } as never

    await expect(removeHandler(ctx, { commentId: 'comments:2' } as never)).rejects.toThrow(
      'Moderator role required',
    )
    expect(patch).not.toHaveBeenCalled()
    expect(insertStatEvent).not.toHaveBeenCalled()
  })

  it('remove no-ops for soft-deleted comment', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:4',
      user: { _id: 'users:4', role: 'moderator' },
    } as never)

    const comment = {
      _id: 'comments:3',
      skillId: 'skills:3',
      userId: 'users:4',
      softDeletedAt: 123,
    }
    const get = vi.fn().mockResolvedValue(comment)
    const insert = vi.fn()
    const patch = vi.fn()
    const ctx = { db: { get, insert, patch } } as never

    await removeHandler(ctx, { commentId: 'comments:3' } as never)

    expect(patch).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
    expect(insertStatEvent).not.toHaveBeenCalled()
  })

  it('report auto-hides comment on the 4th unique report', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:9',
      user: { _id: 'users:9', role: 'user' },
    } as never)

    const comment = {
      _id: 'comments:4',
      skillId: 'skills:4',
      userId: 'users:owner',
      softDeletedAt: undefined,
      moderationStatus: 'active',
      reportCount: 3,
      lastReportedAt: undefined,
    }

    const query = vi.fn((table: string) => {
      if (table !== 'commentReports') throw new Error(`unexpected table ${table}`)
      return {
        withIndex: (name: string) => {
          if (name === 'by_comment_user') return { unique: async () => null }
          if (name === 'by_user') return { collect: async () => [] }
          throw new Error(`unexpected index ${name}`)
        },
      }
    })
    const get = vi.fn().mockResolvedValue(comment)
    const insert = vi.fn()
    const patch = vi.fn()
    const ctx = { db: { get, insert, patch, query } } as never

    const result = await reportHandler(ctx, {
      commentId: 'comments:4',
      reason: 'contains malware loader',
    } as never)

    expect(result).toEqual({ ok: true, reported: true, alreadyReported: false })
    expect(patch).toHaveBeenCalledWith(
      'comments:4',
      expect.objectContaining({
        reportCount: 4,
        moderationStatus: 'hidden',
        moderationReason: 'auto.reports',
      }),
    )
    expect(insertStatEvent).toHaveBeenCalledWith(ctx, {
      skillId: 'skills:4',
      kind: 'uncomment',
    })
    expect(insert).toHaveBeenCalledWith(
      'auditLogs',
      expect.objectContaining({
        action: 'comment.auto_hide',
        targetId: 'comments:4',
      }),
    )
  })

  it('report is idempotent per reporter and comment', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:9',
      user: { _id: 'users:9', role: 'user' },
    } as never)

    const comment = {
      _id: 'comments:4',
      skillId: 'skills:4',
      userId: 'users:owner',
      softDeletedAt: undefined,
      moderationStatus: 'active',
      reportCount: 1,
    }

    const query = vi.fn((table: string) => {
      if (table !== 'commentReports') throw new Error(`unexpected table ${table}`)
      return {
        withIndex: (name: string) => {
          if (name === 'by_comment_user') {
            return { unique: async () => ({ _id: 'commentReports:1' }) }
          }
          throw new Error(`unexpected index ${name}`)
        },
      }
    })
    const get = vi.fn().mockResolvedValue(comment)
    const insert = vi.fn()
    const patch = vi.fn()
    const ctx = { db: { get, insert, patch, query } } as never

    const result = await reportHandler(ctx, {
      commentId: 'comments:4',
      reason: 'malicious',
    } as never)

    expect(result).toEqual({ ok: true, reported: false, alreadyReported: true })
    expect(insert).not.toHaveBeenCalled()
    expect(patch).not.toHaveBeenCalled()
    expect(insertStatEvent).not.toHaveBeenCalled()
  })

  it('report enforces reason requirement and active report cap', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:9',
      user: { _id: 'users:9', role: 'user' },
    } as never)

    const targetComment = {
      _id: 'comments:target',
      skillId: 'skills:9',
      userId: 'users:owner',
      softDeletedAt: undefined,
      moderationStatus: 'active',
      reportCount: 0,
    }

    const activeReports = Array.from({ length: 20 }, (_, index) => ({
      _id: `commentReports:${index}`,
      commentId: `comments:old-${index}`,
      userId: 'users:9',
    }))

    const query = vi.fn((table: string) => {
      if (table !== 'commentReports') throw new Error(`unexpected table ${table}`)
      return {
        withIndex: (name: string) => {
          if (name === 'by_comment_user') return { unique: async () => null }
          if (name === 'by_user') return { collect: async () => activeReports }
          throw new Error(`unexpected index ${name}`)
        },
      }
    })

    const get = vi.fn(async (id: string) => {
      if (id === 'comments:target') return targetComment
      if (id.startsWith('comments:old-')) {
        return {
          _id: id,
          userId: 'users:owner',
          softDeletedAt: undefined,
          moderationStatus: 'active',
        }
      }
      if (id === 'users:owner') return { _id: 'users:owner' }
      return null
    })

    const insert = vi.fn()
    const patch = vi.fn()
    const ctx = { db: { get, insert, patch, query } } as never

    await expect(
      reportHandler(ctx, { commentId: 'comments:target', reason: '   ' } as never),
    ).rejects.toThrow('Report reason required.')

    await expect(
      reportHandler(ctx, { commentId: 'comments:target', reason: 'suspicious payload' } as never),
    ).rejects.toThrow('Report limit reached. Please wait for moderation before reporting more.')
    expect(insert).not.toHaveBeenCalled()
    expect(patch).not.toHaveBeenCalled()
  })

  it('setSoftDeleted hides and restores comments while adjusting stats', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:mod',
      user: { _id: 'users:mod', role: 'moderator' },
    } as never)

    const activeComment = {
      _id: 'comments:5',
      skillId: 'skills:5',
      userId: 'users:owner',
      softDeletedAt: undefined,
      moderationStatus: 'active',
    }
    const hiddenComment = {
      _id: 'comments:6',
      skillId: 'skills:5',
      userId: 'users:owner',
      softDeletedAt: 123,
      moderationStatus: 'hidden',
    }

    const get = vi.fn(async (id: string) => {
      if (id === 'comments:5') return activeComment
      if (id === 'comments:6') return hiddenComment
      return null
    })
    const insert = vi.fn()
    const patch = vi.fn()
    const ctx = { db: { get, insert, patch } } as never

    await setSoftDeletedHandler(ctx, { commentId: 'comments:5', deleted: true } as never)
    await setSoftDeletedHandler(ctx, { commentId: 'comments:6', deleted: false } as never)

    expect(patch).toHaveBeenNthCalledWith(
      1,
      'comments:5',
      expect.objectContaining({
        moderationStatus: 'hidden',
        moderationReason: 'manual.moderation',
      }),
    )
    expect(patch).toHaveBeenNthCalledWith(
      2,
      'comments:6',
      expect.objectContaining({
        moderationStatus: 'active',
        softDeletedAt: undefined,
      }),
    )
    expect(insertStatEvent).toHaveBeenNthCalledWith(1, ctx, { skillId: 'skills:5', kind: 'uncomment' })
    expect(insertStatEvent).toHaveBeenNthCalledWith(2, ctx, { skillId: 'skills:5', kind: 'comment' })
  })

  it('hardDelete removes comment reports and decrements visible comment stats', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: 'users:admin',
      user: { _id: 'users:admin', role: 'admin' },
    } as never)

    const comment = {
      _id: 'comments:7',
      skillId: 'skills:7',
      userId: 'users:owner',
      softDeletedAt: undefined,
      moderationStatus: 'active',
    }

    const query = vi.fn((table: string) => {
      if (table !== 'commentReports') throw new Error(`unexpected table ${table}`)
      return {
        withIndex: (name: string) => {
          if (name === 'by_comment') {
            return {
              collect: async () => [{ _id: 'commentReports:1' }, { _id: 'commentReports:2' }],
            }
          }
          throw new Error(`unexpected index ${name}`)
        },
      }
    })

    const get = vi.fn().mockResolvedValue(comment)
    const insert = vi.fn()
    const patch = vi.fn()
    const del = vi.fn()
    const ctx = { db: { get, insert, patch, delete: del, query } } as never

    const result = await hardDeleteHandler(ctx, { commentId: 'comments:7' } as never)

    expect(result).toEqual({ deleted: true })
    expect(del).toHaveBeenCalledWith('commentReports:1')
    expect(del).toHaveBeenCalledWith('commentReports:2')
    expect(del).toHaveBeenCalledWith('comments:7')
    expect(insertStatEvent).toHaveBeenCalledWith(ctx, {
      skillId: 'skills:7',
      kind: 'uncomment',
    })
    expect(insert).toHaveBeenCalledWith(
      'auditLogs',
      expect.objectContaining({
        action: 'comment.hard_delete',
      }),
    )
  })
})
