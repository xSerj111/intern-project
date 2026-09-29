import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { fakePost } from '../../test/fixtures';
import {
  archivePost,
  createPost,
  deletePost,
  publishPost,
  updatePost,
} from '../api/posts';
import {
  useArchivePost,
  useCreatePost,
  useDeletePost,
  usePublishPost,
  useUpdatePost,
} from './use-post-mutations';

jest.mock('../auth/auth-context', () => ({
  useAuth: () => ({ accessToken: 'test-token' }),
}));

jest.mock('../api/posts', () => ({
  archivePost: jest.fn(),
  createPost: jest.fn(),
  deletePost: jest.fn(),
  publishPost: jest.fn(),
  updatePost: jest.fn(),
}));

function setup() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, invalidate, wrapper };
}

function invalidatedKeys(spy: jest.SpyInstance): unknown[] {
  return spy.mock.calls.map(
    ([filters]) => (filters as { queryKey: unknown }).queryKey,
  );
}

describe('post mutation hooks', () => {
  it('create invalidates feed, search and the new post', async () => {
    const { invalidate, wrapper } = setup();
    jest.mocked(createPost).mockResolvedValue(fakePost({ id: 'new-1' }));
    const { result } = renderHook(() => useCreatePost(), { wrapper });

    await act(() =>
      result.current.mutateAsync({ content: 'hi', assetIds: [] }),
    );

    await waitFor(() => {
      expect(invalidatedKeys(invalidate)).toEqual(
        expect.arrayContaining([['feed'], ['search'], ['post', 'new-1']]),
      );
    });
  });

  it.each([
    [
      'update',
      () => useUpdatePost('p1'),
      updatePost,
      { content: 'x', assetIds: [] },
    ],
    ['publish', () => usePublishPost('p1'), publishPost, undefined],
    ['archive', () => useArchivePost('p1'), archivePost, undefined],
  ] as const)(
    '%s invalidates feed, search and post(id)',
    async (_name, useHook, api, variables) => {
      const { invalidate, wrapper } = setup();
      jest.mocked(api as jest.Mock).mockResolvedValue(fakePost({ id: 'p1' }));
      const { result } = renderHook(() => useHook() as never, { wrapper });

      await act(() =>
        (
          result.current as { mutateAsync: (v: unknown) => Promise<unknown> }
        ).mutateAsync(variables),
      );

      await waitFor(() => {
        expect(invalidatedKeys(invalidate)).toEqual(
          expect.arrayContaining([['feed'], ['search'], ['post', 'p1']]),
        );
      });
    },
  );

  it('delete removes post(id) without refetching it, and invalidates feed and search', async () => {
    const { client, invalidate, wrapper } = setup();
    const remove = jest.spyOn(client, 'removeQueries');
    jest.mocked(deletePost).mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeletePost('p1'), { wrapper });

    await act(() => result.current.mutateAsync());

    expect(remove).toHaveBeenCalledWith({ queryKey: ['post', 'p1'] });
    expect(invalidatedKeys(invalidate)).toEqual(
      expect.arrayContaining([['feed'], ['search']]),
    );
    expect(invalidatedKeys(invalidate)).not.toContainEqual(['post', 'p1']);
  });
});
