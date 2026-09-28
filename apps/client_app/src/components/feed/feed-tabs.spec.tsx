import { fireEvent, render, screen } from '@testing-library/react';

import { FeedTabs } from './feed-tabs';

jest.mock('./feed-list', () => ({
  FeedList: ({ sort, mediaType }: { sort?: string; mediaType?: string }) => (
    <div
      data-testid="feed-list"
      data-sort={sort ?? ''}
      data-media={mediaType ?? ''}
    />
  ),
}));

function feedList(): HTMLElement {
  return screen.getByTestId('feed-list');
}

describe('FeedTabs', () => {
  it('renders feed tabs and sort/media controls with the newest default', () => {
    render(<FeedTabs />);

    expect(screen.getByRole('tab', { name: 'Following' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Discover' })).toBeInTheDocument();
    expect(screen.getByLabelText('Sort')).toBeInTheDocument();
    expect(screen.getByLabelText('Media')).toBeInTheDocument();
    expect(feedList()).toHaveAttribute('data-sort', 'newest');
    expect(feedList()).toHaveAttribute('data-media', '');
  });

  it('applies a sort change and clears it back to the default', () => {
    render(<FeedTabs />);

    fireEvent.change(screen.getByLabelText('Sort'), {
      target: { value: 'oldest' },
    });

    expect(feedList()).toHaveAttribute('data-sort', 'oldest');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(feedList()).toHaveAttribute('data-sort', 'newest');
    expect(
      screen.queryByRole('button', { name: 'Clear' }),
    ).not.toBeInTheDocument();
  });

  it('applies a media-type filter', () => {
    render(<FeedTabs />);

    fireEvent.change(screen.getByLabelText('Media'), {
      target: { value: 'videos' },
    });

    expect(feedList()).toHaveAttribute('data-media', 'videos');
  });
});
