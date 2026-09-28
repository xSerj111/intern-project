import type { IAuthUserResponse, ICommentResponse } from '@repo/contracts';
import { screen, waitFor } from '@testing-library/react';

import { useAuth } from '../../lib/auth/auth-context';
import { getCommentsByPost } from '../../lib/api/comments';
import { fakePost } from '../../test/fixtures';
import { renderWithQuery } from '../../test/render';
import { Comments } from './comments';

jest.mock('../../lib/auth/auth-context', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../lib/api/comments', () => ({
  createComment: jest.fn(),
  deleteComment: jest.fn(),
  getCommentsByPost: jest.fn(),
  updateComment: jest.fn(),
}));

const mockedUseAuth = jest.mocked(useAuth);

function authValue(
  overrides: Partial<ReturnType<typeof useAuth>> = {},
): ReturnType<typeof useAuth> {
  return {
    session: null,
    accessToken: 'test-token',
    user: null,
    isSignedIn: false,
    isHydrated: true,
    login: jest.fn(),
    loginWithGoogle: jest.fn(),
    logout: jest.fn(),
    ...overrides,
  };
}

function fakeComment(overrides: Partial<ICommentResponse> = {}): ICommentResponse {
  return {
    id: 'comment-1',
    postId: fakePost().id,
    parentId: null,
    author: {
      id: 'author-1',
      username: 'grace',
      displayName: 'Grace Hopper',
      avatarUrl: null,
    },
    content: 'Nice post!',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('Comments', () => {
  it('renders the comment thread from the API', async () => {
    mockedUseAuth.mockReturnValue(
      authValue({
        isSignedIn: true,
        user: { id: 'viewer-1' } as IAuthUserResponse,
      }),
    );
    jest.mocked(getCommentsByPost).mockResolvedValue([fakeComment()]);

    renderWithQuery(<Comments postId={fakePost().id} />);

    expect(await screen.findByText('Nice post!')).toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Add a comment…')).toBeInTheDocument();
  });

  it('shows an empty state when there are no comments', async () => {
    mockedUseAuth.mockReturnValue(authValue());
    jest.mocked(getCommentsByPost).mockResolvedValue([]);

    renderWithQuery(<Comments postId={fakePost().id} />);

    expect(
      await screen.findByText('No comments yet. Be the first!'),
    ).toBeInTheDocument();
  });

  it('prompts signed-out visitors to sign in instead of showing the composer', async () => {
    mockedUseAuth.mockReturnValue(authValue({ isSignedIn: false }));
    jest.mocked(getCommentsByPost).mockResolvedValue([]);

    renderWithQuery(<Comments postId={fakePost().id} />);

    await waitFor(() => {
      expect(
        screen.getByText('Sign in to join the conversation.'),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByPlaceholderText('Add a comment…'),
    ).not.toBeInTheDocument();
  });
});
