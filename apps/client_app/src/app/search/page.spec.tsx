import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';

import { fakePost } from '../../test/fixtures';
import { renderWithQuery as render } from '../../test/render';
import { searchPosts } from '../../lib/api/search';
import SearchPage from './page';

const replace = jest.fn();
let search = '';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/search',
  useSearchParams: () => new URLSearchParams(search),
}));
jest.mock('../../lib/auth/auth-context', () => ({
  useAuth: () => ({ accessToken: 'test-token' }),
}));
jest.mock('../../lib/api/search', () => ({ searchPosts: jest.fn() }));
jest.mock('../../components/feed/post-card', () => ({
  PostCard: ({ post, highlight }: { post: { id: string }; highlight?: string }) => (
    <div data-testid="post-card">{`${post.id}:${highlight ?? ''}`}</div>
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

describe('SearchPage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    search = '';
    (searchPosts as jest.Mock).mockResolvedValue({
      items: [fakePost({ id: 'p1' })],
      total: 1,
      page: 1,
      limit: 20,
    });
  });
  afterEach(() => jest.useRealTimers());

  it('pre-fills from ?q= and runs the search', async () => {
    search = 'q=hello';
    render(<SearchPage />);

    expect(screen.getByLabelText('Search posts')).toHaveValue('hello');
    await waitFor(() =>
      expect(searchPosts).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: 'hello' }),
      ),
    );
    expect(await screen.findByTestId('post-card')).toHaveTextContent('p1:hello');
  });

  it('debounces typing into a single URL update', () => {
    render(<SearchPage />);
    const input = screen.getByLabelText('Search posts');

    fireEvent.change(input, { target: { value: 'hel' } });
    act(() => void jest.advanceTimersByTime(200));
    fireEvent.change(input, { target: { value: 'hello' } });
    act(() => void jest.advanceTimersByTime(399));
    expect(replace).not.toHaveBeenCalled();

    act(() => void jest.advanceTimersByTime(1));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/search?q=hello', { scroll: false });
  });

  it('does not search under 3 characters', () => {
    render(<SearchPage />);

    fireEvent.change(screen.getByLabelText('Search posts'), {
      target: { value: 'he' },
    });
    act(() => void jest.advanceTimersByTime(1000));

    expect(replace).not.toHaveBeenCalled();
    expect(searchPosts).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/at least 3/i);
  });

  it('submits immediately without waiting for the debounce', () => {
    render(<SearchPage />);

    fireEvent.change(screen.getByLabelText('Search posts'), {
      target: { value: 'hello' },
    });
    fireEvent.submit(screen.getByRole('search'));

    expect(replace).toHaveBeenCalledWith('/search?q=hello', { scroll: false });
  });

  it('mirrors an external ?q= change (back/forward, nav link) in the input', () => {
    search = 'q=foo';
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const ui = () => (
      <QueryClientProvider client={client}>
        <SearchPage />
      </QueryClientProvider>
    );
    const { rerender } = rtlRender(ui());
    expect(screen.getByLabelText('Search posts')).toHaveValue('foo');

    search = '';
    rerender(ui());

    expect(screen.getByLabelText('Search posts')).toHaveValue('');
  });
});
