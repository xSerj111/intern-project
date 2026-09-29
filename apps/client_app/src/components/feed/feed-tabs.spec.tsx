import { fireEvent, render, screen } from '@testing-library/react';

import { FeedTabs } from './feed-tabs';

const replace = jest.fn();
let search = '';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(search),
}));

jest.mock('./feed-list', () => ({
  FeedList: ({
    feed,
    sort,
    mediaType,
  }: {
    feed?: string;
    sort?: string;
    mediaType?: string;
  }) => (
    <div
      data-testid="feed-list"
      data-feed={feed ?? ''}
      data-sort={sort ?? ''}
      data-media={mediaType ?? ''}
    />
  ),
}));

function feedList(): HTMLElement {
  return screen.getByTestId('feed-list');
}

describe('FeedTabs', () => {
  beforeEach(() => {
    search = '';
    replace.mockClear();
  });

  it('renders feed tabs and sort/media controls with the newest default', () => {
    render(<FeedTabs />);

    expect(screen.getByRole('tab', { name: 'Following' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Discover' })).toBeInTheDocument();
    expect(feedList()).toHaveAttribute('data-sort', 'newest');
    expect(feedList()).toHaveAttribute('data-media', '');
  });

  it('reads the controls from the URL', () => {
    search = 'feed=discover&sort=most_liked&mediaType=videos';
    render(<FeedTabs />);

    expect(screen.getByRole('tab', { name: 'Discover' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByLabelText('Sort')).toHaveValue('most_liked');
    expect(screen.getByLabelText('Media')).toHaveValue('videos');
    expect(feedList()).toHaveAttribute('data-feed', 'discover');
    expect(feedList()).toHaveAttribute('data-sort', 'most_liked');
    expect(feedList()).toHaveAttribute('data-media', 'videos');
  });

  it('ignores invalid URL values', () => {
    search = 'feed=nope&sort=bogus&mediaType=gifs';
    render(<FeedTabs />);

    expect(feedList()).toHaveAttribute('data-feed', 'following');
    expect(feedList()).toHaveAttribute('data-sort', 'newest');
    expect(feedList()).toHaveAttribute('data-media', '');
  });

  it('writes a sort change to the URL and omits defaults', () => {
    render(<FeedTabs />);

    fireEvent.change(screen.getByLabelText('Sort'), {
      target: { value: 'oldest' },
    });

    expect(replace).toHaveBeenCalledWith('/?sort=oldest', { scroll: false });
  });

  it('keeps other params when one changes', () => {
    search = 'sort=oldest';
    render(<FeedTabs />);

    fireEvent.change(screen.getByLabelText('Media'), {
      target: { value: 'videos' },
    });

    expect(replace).toHaveBeenCalledWith('/?sort=oldest&mediaType=videos', {
      scroll: false,
    });
  });

  it('switches tab via the URL', () => {
    render(<FeedTabs />);

    fireEvent.click(screen.getByRole('tab', { name: 'Discover' }));

    expect(replace).toHaveBeenCalledWith('/?feed=discover', { scroll: false });
  });

  it('Clear resets sort and media but keeps the tab', () => {
    search = 'feed=discover&sort=oldest&mediaType=text';
    render(<FeedTabs />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(replace).toHaveBeenCalledWith('/?feed=discover', { scroll: false });
  });
});
