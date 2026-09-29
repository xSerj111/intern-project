import { screen, waitFor } from '@testing-library/react';

import { fakePost } from '../../test/fixtures';
import { renderWithQuery as render } from '../../test/render';
import { getFeed } from '../../lib/api/feed';
import { useAuth } from '../../lib/auth/auth-context';
import { FeedList } from './feed-list';

jest.mock('../../lib/api/feed', () => ({ getFeed: jest.fn() }));
jest.mock('../../lib/auth/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('./post-card', () => ({
  PostCard: ({ post }: { post: { id: string } }) => (
    <div data-testid="post-card">{post.id}</div>
  ),
}));

beforeAll(() => {
  global.IntersectionObserver = class {
    observe = jest.fn();
    disconnect = jest.fn();
    unobserve = jest.fn();
    takeRecords = jest.fn();
    root = null;
    rootMargin = '';
    thresholds = [];
  };
});

function signedIn(value: boolean) {
  (useAuth as jest.Mock).mockReturnValue({
    accessToken: value ? 't' : null,
    isHydrated: true,
    isSignedIn: value,
  });
}

describe('FeedList', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders a post that appears twice in the response only once', async () => {
    signedIn(true);
    (getFeed as jest.Mock).mockResolvedValue({
      items: [fakePost({ id: 'a' }), fakePost({ id: 'b' }), fakePost({ id: 'a' })],
      total: 3,
      page: 1,
      limit: 20,
    });

    render(<FeedList />);

    await waitFor(() =>
      expect(screen.getAllByTestId('post-card')).toHaveLength(2),
    );
  });

  it('passes feed, sort and mediaType to the API', async () => {
    signedIn(true);
    (getFeed as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });

    render(<FeedList feed="discover" sort="most_liked" mediaType="videos" />);

    await waitFor(() =>
      expect(getFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          feed: 'discover',
          sort: 'most_liked',
          mediaType: 'videos',
        }),
      ),
    );
  });

  it('shows a sign-in call to action on Discover when signed out', () => {
    signedIn(false);

    render(<FeedList feed="discover" />);

    expect(screen.getByText(/sign in to discover/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(getFeed).not.toHaveBeenCalled();
  });
});
