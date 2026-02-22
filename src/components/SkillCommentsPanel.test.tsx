import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Id } from '../../convex/_generated/dataModel'
import { SkillCommentsPanel } from './SkillCommentsPanel'

const useMutationMock = vi.fn()
const useQueryMock = vi.fn()

const addCommentMock = vi.fn()
const removeCommentMock = vi.fn()
const reportCommentMock = vi.fn()

vi.mock('convex/react', () => ({
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}))

describe('SkillCommentsPanel', () => {
  beforeEach(() => {
    useMutationMock.mockReset()
    useQueryMock.mockReset()
    addCommentMock.mockReset()
    removeCommentMock.mockReset()
    reportCommentMock.mockReset()

    let mutationCall = 0
    useMutationMock.mockImplementation(() => {
      mutationCall += 1
      const slot = ((mutationCall - 1) % 3) + 1
      if (slot === 1) return addCommentMock
      if (slot === 2) return removeCommentMock
      return reportCommentMock
    })

    useQueryMock.mockReturnValue([
      {
        comment: {
          _id: 'comments:1',
          userId: 'users:other',
          body: 'suspicious command',
        },
        user: { handle: 'other-user' },
      },
    ])

    vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens report dialog for authenticated users', async () => {
    render(
      <SkillCommentsPanel
        skillId={'skills:1' as Id<'skills'>}
        isAuthenticated
        me={{ _id: 'users:me', role: 'user' } as never}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Report' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Report comment')).toBeTruthy()
  })

  it('submits comment reports with a trimmed reason', async () => {
    reportCommentMock.mockResolvedValue({ reported: true })

    render(
      <SkillCommentsPanel
        skillId={'skills:1' as Id<'skills'>}
        isAuthenticated
        me={{ _id: 'users:me', role: 'user' } as never}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Report' }))
    fireEvent.change(screen.getByLabelText('Comment report reason'), {
      target: { value: '  malware loader  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }))

    await waitFor(() => {
      expect(reportCommentMock).toHaveBeenCalledWith({
        commentId: 'comments:1',
        reason: 'malware loader',
      })
    })
    expect(window.alert).toHaveBeenCalledWith('Thanks — your report has been submitted.')
  })
})
