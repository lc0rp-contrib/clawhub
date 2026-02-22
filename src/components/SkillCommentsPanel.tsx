import { useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import { isModerator } from '../lib/roles'
import { CommentReportDialog } from './CommentReportDialog'

type SkillCommentsPanelProps = {
  skillId: Id<'skills'>
  isAuthenticated: boolean
  me: Doc<'users'> | null
}

export function SkillCommentsPanel({ skillId, isAuthenticated, me }: SkillCommentsPanelProps) {
  const addComment = useMutation(api.comments.add)
  const removeComment = useMutation(api.comments.remove)
  const reportComment = useMutation(api.comments.report)
  const [comment, setComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletingCommentId, setDeletingCommentId] = useState<Id<'comments'> | null>(null)
  const [reportCommentId, setReportCommentId] = useState<Id<'comments'> | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [reportError, setReportError] = useState<string | null>(null)
  const [isSubmittingReport, setIsSubmittingReport] = useState(false)
  const comments = useQuery(api.comments.listBySkill, { skillId, limit: 50 })

  const submitComment = async () => {
    const body = comment.trim()
    if (!body || isSubmitting) return
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      await addComment({ skillId, body })
      setComment('')
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to post comment')
    } finally {
      setIsSubmitting(false)
    }
  }

  const deleteComment = async (commentId: Id<'comments'>) => {
    if (deletingCommentId) return
    setDeleteError(null)
    setDeletingCommentId(commentId)
    try {
      await removeComment({ commentId })
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete comment')
    } finally {
      setDeletingCommentId(null)
    }
  }

  const closeReportDialog = () => {
    setReportCommentId(null)
    setReportReason('')
    setReportError(null)
    setIsSubmittingReport(false)
  }

  const openReportDialog = (commentId: Id<'comments'>) => {
    setReportCommentId(commentId)
    setReportReason('')
    setReportError(null)
    setIsSubmittingReport(false)
  }

  const submitReport = async () => {
    if (!reportCommentId) return
    const trimmedReason = reportReason.trim()
    if (!trimmedReason) {
      setReportError('Report reason required.')
      return
    }

    setIsSubmittingReport(true)
    setReportError(null)
    try {
      const result = await reportComment({ commentId: reportCommentId, reason: trimmedReason })
      closeReportDialog()
      if (result.reported) {
        window.alert('Thanks — your report has been submitted.')
      } else {
        window.alert('You have already reported this comment.')
      }
    } catch (error) {
      setReportError(formatReportError(error))
      setIsSubmittingReport(false)
    }
  }

  return (
    <>
      <div className="card">
        <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
          Comments
        </h2>
        {isAuthenticated ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submitComment()
            }}
            className="comment-form"
          >
            <textarea
              className="comment-input"
              rows={4}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Leave a note…"
              disabled={isSubmitting}
            />
            {submitError ? <div className="report-dialog-error">{submitError}</div> : null}
            <button className="btn comment-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Posting…' : 'Post comment'}
            </button>
          </form>
        ) : (
          <p className="section-subtitle">Sign in to comment.</p>
        )}
        {deleteError ? <div className="report-dialog-error">{deleteError}</div> : null}
        <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          {(comments ?? []).length === 0 ? (
            <div className="stat">No comments yet.</div>
          ) : (
            (comments ?? []).map((entry) => (
              <div key={entry.comment._id} className="comment-item">
                <div className="comment-body">
                  <strong>@{entry.user?.handle ?? entry.user?.name ?? 'user'}</strong>
                  <div className="comment-body-text">{entry.comment.body}</div>
                </div>
                {isAuthenticated ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => openReportDialog(entry.comment._id)}
                      disabled={Boolean(deletingCommentId) || isSubmittingReport}
                    >
                      Report
                    </button>
                    {me && (me._id === entry.comment.userId || isModerator(me)) ? (
                      <button
                        className="btn comment-delete"
                        type="button"
                        onClick={() => void deleteComment(entry.comment._id)}
                        disabled={Boolean(deletingCommentId) || isSubmitting}
                      >
                        {deletingCommentId === entry.comment._id ? 'Deleting…' : 'Delete'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
      <CommentReportDialog
        isOpen={isAuthenticated && Boolean(reportCommentId)}
        isSubmitting={isSubmittingReport}
        reportReason={reportReason}
        reportError={reportError}
        onReasonChange={setReportReason}
        onCancel={closeReportDialog}
        onSubmit={() => void submitReport()}
      />
    </>
  )
}

function formatReportError(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data
    if (typeof data === 'string' && data.trim()) return data.trim()
    if (
      data &&
      typeof data === 'object' &&
      'message' in data &&
      typeof (data as { message?: unknown }).message === 'string'
    ) {
      const message = (data as { message?: string }).message?.trim()
      if (message) return message
    }
  }

  if (error instanceof Error) {
    const cleaned = error.message
      .replace(/\[CONVEX[^\]]*\]\s*/g, '')
      .replace(/\[Request ID:[^\]]*\]\s*/g, '')
      .replace(/^Server Error Called by client\s*/i, '')
      .replace(/^ConvexError:\s*/i, '')
      .trim()
    if (cleaned && cleaned !== 'Server Error') return cleaned
  }

  return 'Unable to submit report. Please try again.'
}
