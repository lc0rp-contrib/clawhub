/* @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from '../routes/management'

const useQueryMock = vi.fn()
const useMutationMock = vi.fn()
const useAuthStatusMock = vi.fn()
const searchMock: Record<string, unknown> = {}

const setRoleMock = vi.fn()
const banUserMock = vi.fn()
const setBatchMock = vi.fn()
const setSoftDeletedSkillMock = vi.fn()
const hardDeleteSkillMock = vi.fn()
const setSoftDeletedCommentMock = vi.fn()
const hardDeleteCommentMock = vi.fn()
const changeOwnerMock = vi.fn()
const setDuplicateMock = vi.fn()
const setOfficialBadgeMock = vi.fn()
const setDeprecatedBadgeMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    (config: { component: unknown; validateSearch: unknown }) => ({
      ...config,
      useSearch: () => searchMock,
    }),
  Link: (props: { children: ReactNode }) => <a href="/">{props.children}</a>,
}))

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}))

vi.mock('../lib/useAuthStatus', () => ({
  useAuthStatus: () => useAuthStatusMock(),
}))

describe('Management route', () => {
  beforeEach(() => {
    useQueryMock.mockReset()
    useMutationMock.mockReset()
    useAuthStatusMock.mockReset()

    setRoleMock.mockReset()
    banUserMock.mockReset()
    setBatchMock.mockReset()
    setSoftDeletedSkillMock.mockReset()
    hardDeleteSkillMock.mockReset()
    setSoftDeletedCommentMock.mockReset()
    hardDeleteCommentMock.mockReset()
    changeOwnerMock.mockReset()
    setDuplicateMock.mockReset()
    setOfficialBadgeMock.mockReset()
    setDeprecatedBadgeMock.mockReset()

    useAuthStatusMock.mockReturnValue({
      me: { _id: 'users:admin', role: 'admin' },
    })

    let mutationCall = 0
    const mutationFns = [
      setRoleMock,
      banUserMock,
      setBatchMock,
      setSoftDeletedSkillMock,
      hardDeleteSkillMock,
      setSoftDeletedCommentMock,
      hardDeleteCommentMock,
      changeOwnerMock,
      setDuplicateMock,
      setOfficialBadgeMock,
      setDeprecatedBadgeMock,
    ]
    useMutationMock.mockImplementation(() => {
      mutationCall += 1
      const slot = (mutationCall - 1) % mutationFns.length
      return mutationFns[slot]
    })

    let limit20Calls = 0
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === 'skip') return undefined
      if (args && typeof args === 'object' && 'search' in args) {
        return { items: [], total: 0 }
      }
      if (args && typeof args === 'object' && 'limit' in args) {
        const limit = (args as { limit: number }).limit
        if (limit === 20) {
          limit20Calls += 1
          return limit20Calls === 1 ? [] : []
        }
        if (limit === 25) return []
        if (limit === 30) {
          return [
            {
              comment: {
                _id: 'comments:1',
                skillId: 'skills:1',
                userId: 'users:commenter',
                body: 'base64 | bash',
                reportCount: 4,
                lastReportedAt: 1700000000000,
                softDeletedAt: undefined,
              },
              skill: {
                _id: 'skills:1',
                slug: 'blogwatcher',
                displayName: 'Blogwatcher',
                ownerUserId: 'users:owner',
              },
              owner: {
                _id: 'users:owner',
                handle: 'steipete',
                name: 'Peter',
              },
              commenter: {
                _id: 'users:commenter',
                handle: 'spammer',
                name: 'Spammer',
              },
              reports: [
                {
                  reason: 'suspicious download-and-execute command',
                  createdAt: 1700000000000,
                  reporterHandle: 'alice',
                  reporterId: 'users:alice',
                },
              ],
            },
          ]
        }
      }
      return undefined
    })

    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders reported comments with report reasons', () => {
    const Component = (Route as unknown as { component: () => JSX.Element }).component
    render(<Component />)

    fireEvent.click(screen.getByRole('tab', { name: 'Reported comments' }))

    expect(screen.getByRole('heading', { name: 'Reported comments' })).toBeTruthy()
    expect(screen.getByText('Blogwatcher')).toBeTruthy()
    expect(screen.getByText('base64 | bash')).toBeTruthy()
    expect(screen.getByText('suspicious download-and-execute command')).toBeTruthy()
  })

  it('calls comment moderation mutations from reported comments actions', () => {
    const Component = (Route as unknown as { component: () => JSX.Element }).component
    render(<Component />)

    fireEvent.click(screen.getByRole('tab', { name: 'Reported comments' }))

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(setSoftDeletedCommentMock).toHaveBeenCalledWith({
      commentId: 'comments:1',
      deleted: true,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Hard delete' }))
    expect(hardDeleteCommentMock).toHaveBeenCalledWith({ commentId: 'comments:1' })
  })
})
