type CommentReportDialogProps = {
  isOpen: boolean
  isSubmitting: boolean
  reportReason: string
  reportError: string | null
  onReasonChange: (value: string) => void
  onCancel: () => void
  onSubmit: () => void
}

export function CommentReportDialog({
  isOpen,
  isSubmitting,
  reportReason,
  reportError,
  onReasonChange,
  onCancel,
  onSubmit,
}: CommentReportDialogProps) {
  if (!isOpen) return null

  return (
    <div className="report-dialog-backdrop">
      <div className="report-dialog" role="dialog" aria-modal="true" aria-labelledby="comment-report-title">
        <h2 id="comment-report-title" className="section-title" style={{ margin: 0, fontSize: '1.1rem' }}>
          Report comment
        </h2>
        <p className="section-subtitle" style={{ margin: 0 }}>
          Describe the issue so moderators can review it quickly.
        </p>
        <form
          className="report-dialog-form"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
        >
          <textarea
            className="report-dialog-textarea"
            aria-label="Comment report reason"
            placeholder="What should moderators know?"
            value={reportReason}
            onChange={(event) => onReasonChange(event.target.value)}
            rows={5}
            disabled={isSubmitting}
          />
          {reportError ? <p className="report-dialog-error">{reportError}</p> : null}
          <div className="report-dialog-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                if (!isSubmitting) onCancel()
              }}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn" disabled={isSubmitting}>
              {isSubmitting ? 'Submitting…' : 'Submit report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
