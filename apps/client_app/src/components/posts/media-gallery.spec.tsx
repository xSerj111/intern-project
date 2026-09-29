import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { fakeMedia } from '../../test/fixtures';
import { MediaGallery } from './media-gallery';

const assets = [
  fakeMedia({ assetId: 'a1', url: 'https://example.test/1.png' }),
  fakeMedia({
    assetId: 'a2',
    url: 'https://example.test/2.mp4',
    mediaType: 'video',
    displayOrder: 1,
  }),
  fakeMedia({ assetId: 'a3', url: 'https://example.test/3.png', displayOrder: 2 }),
];

describe('MediaGallery', () => {
  it('describes images with position and author', () => {
    render(<MediaGallery assets={assets} authorLabel="@ada" onClose={jest.fn()} />);

    expect(screen.getByAltText('Image 1 of 3 by @ada')).toBeInTheDocument();
  });

  it('navigates with arrow keys and closes on Escape', () => {
    const onClose = jest.fn();
    render(<MediaGallery assets={assets} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders video items with controls', () => {
    const { container } = render(
      <MediaGallery assets={assets} startIndex={1} onClose={jest.fn()} />,
    );

    expect(container.querySelector('video')).toHaveAttribute('controls');
  });

  it('swipes to the next and previous item', () => {
    render(<MediaGallery assets={assets} onClose={jest.fn()} />);
    const stage = screen.getByTestId('gallery-stage');

    fireEvent.touchStart(stage, { touches: [{ clientX: 200 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 100 }] });
    expect(screen.getByText('2 / 3')).toBeInTheDocument();

    fireEvent.touchStart(stage, { touches: [{ clientX: 100 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 220 }] });
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('moves focus in, traps Tab, and returns focus to the trigger on close', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>open</button>
          {open && <MediaGallery assets={assets} onClose={() => setOpen(false)} />}
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByText('open');
    trigger.focus();
    fireEvent.click(trigger);

    const close = screen.getByLabelText('Close gallery');
    expect(close).toHaveFocus();

    // Shift+Tab from the first focusable wraps to the last one.
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(screen.getByLabelText('Next media')).toHaveFocus();

    // Tab from the last focusable wraps back to the first one.
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(trigger).toHaveFocus();
  });
});
