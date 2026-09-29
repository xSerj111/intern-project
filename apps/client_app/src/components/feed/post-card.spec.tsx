import { fireEvent, screen } from '@testing-library/react';

import { fakeMedia, fakePost } from '../../test/fixtures';
import { renderWithQuery as render } from '../../test/render';
import { PostCard } from './post-card';

jest.mock('../../lib/auth/auth-context', () => ({
  useAuth: () => ({ accessToken: 'test-token' }),
}));

describe('PostCard', () => {
  it('renders the author, text and engagement counts', () => {
    render(<PostCard post={fakePost()} />);

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('@ada')).toBeInTheDocument();
    expect(screen.getByText('Hello world')).toBeInTheDocument();
    expect(screen.getByText('♥ 3')).toBeInTheDocument();
    expect(screen.getByText('💬 2')).toBeInTheDocument();
    expect(screen.getByText('🔁 1')).toBeInTheDocument();
  });

  it('renders text-only posts without any media placeholder', () => {
    const { container } = render(<PostCard post={fakePost({ assets: [] })} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('video')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /open media/i }),
    ).not.toBeInTheDocument();
  });

  it('opens the gallery when a media thumbnail is clicked and closes on Escape', () => {
    render(
      <PostCard
        post={fakePost({
          assets: [
            fakeMedia({ assetId: 'asset-1', url: 'https://example.test/1.png' }),
            fakeMedia({
              assetId: 'asset-2',
              url: 'https://example.test/2.png',
              displayOrder: 1,
            }),
          ],
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open media 1 of 2' }));

    const dialog = screen.getByRole('dialog', { name: 'Media gallery' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(
      screen.queryByRole('dialog', { name: 'Media gallery' }),
    ).not.toBeInTheDocument();
  });

  it('highlights the search term case-insensitively, escaping regex characters', () => {
    const { container } = render(
      <PostCard post={fakePost({ content: 'Hello (world) hello' })} highlight="HELLO" />,
    );
    expect(container.querySelectorAll('mark')).toHaveLength(2);

    const { container: other } = render(
      <PostCard post={fakePost({ content: 'a (b) c' })} highlight="(b)" />,
    );
    expect(other.querySelector('mark')).toHaveTextContent('(b)');
  });
});
