import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { IFeedResponse, IPostResponse } from '@repo/contracts';

import { fakePost } from '../../test/fixtures';
import { likePost, unlikePost } from '../../lib/api/likes';
import { repostPost } from '../../lib/api/reposts';
import { PostActions } from './post-actions';

jest.mock('../../lib/auth/auth-context', () => ({
  useAuth: () => ({ accessToken: 'test-token' }),
}));
jest.mock('../../lib/api/likes', () => ({
  likePost: jest.fn(),
  unlikePost: jest.fn(),
}));
jest.mock('../../lib/api/reposts', () => ({
  repostPost: jest.fn(),
  unrepostPost: jest.fn(),
}));

const post = fakePost({ id: 'p1', likeCount: 3, repostCount: 1 });

/** Renders the actions from a post held in a cached feed page, like a feed card. */
function setup(initial: IPostResponse = post) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const page: IFeedResponse = { items: [initial], total: 1, page: 1, limit: 20 };
  client.setQueryData(['feed', 'following', 'newest', undefined, 't'], {
    pages: [page],
    pageParams: [1],
  });
  const cached = () =>
    (
      client.getQueryData(['feed', 'following', 'newest', undefined, 't']) as {
        pages: IFeedResponse[];
      }
    ).pages[0].items[0] as IPostResponse;

  function Harness() {
    return <PostActions post={cached()} />;
  }
  const view = render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  return { client, cached, ...view };
}

describe('PostActions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('updates the cached like count and state before the request settles', async () => {
    (likePost as jest.Mock).mockReturnValue(new Promise(() => undefined));
    const { cached } = setup();

    fireEvent.click(screen.getByRole('button', { name: /♥ 3/ }));

    await waitFor(() => expect(cached().likeCount).toBe(4));
    expect(cached().likedByMe).toBe(true);
    expect(likePost).toHaveBeenCalledWith('test-token', 'p1');
  });

  it('unlikes a liked post', async () => {
    (unlikePost as jest.Mock).mockReturnValue(new Promise(() => undefined));
    const { cached } = setup(fakePost({ id: 'p1', likeCount: 3, likedByMe: true }));

    fireEvent.click(screen.getByRole('button', { name: /♥ 3/ }));

    await waitFor(() => expect(cached().likeCount).toBe(2));
    expect(cached().likedByMe).toBe(false);
  });

  it('rolls the like back when the request fails', async () => {
    (likePost as jest.Mock).mockRejectedValue(new Error('boom'));
    const { cached } = setup();

    fireEvent.click(screen.getByRole('button', { name: /♥ 3/ }));

    await waitFor(() => expect(likePost).toHaveBeenCalled());
    await waitFor(() => expect(cached().likeCount).toBe(3));
    expect(cached().likedByMe).toBe(false);
  });

  it('marks a repost and bumps its count optimistically', async () => {
    (repostPost as jest.Mock).mockReturnValue(new Promise(() => undefined));
    const { cached } = setup();

    fireEvent.click(screen.getByRole('button', { name: /🔁 1/ }));

    await waitFor(() => expect(cached().repostCount).toBe(2));
    expect(screen.getByRole('button', { name: /🔁/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('copies the link when the native share sheet is unavailable', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    setup();

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toMatch(/\/posts\/p1$/);
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });
});
