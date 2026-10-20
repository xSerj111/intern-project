'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';

import type { IPostAssetResponse } from '@repo/contracts';

import { cx } from '../../lib/cx';

import styles from './image-carousel.module.css';

/** Feed images are cropped into this ratio range (portrait .. wide). */
const MIN_RATIO = 4 / 5;
const MAX_RATIO = 1.91;

interface ImageCarouselProps {
  assets: IPostAssetResponse[];
  /** `detail` fills its parent on desktop and shows the whole image. */
  variant?: 'feed' | 'detail';
  className?: string;
}

/** The post's displayable images in display order (assets without a URL are skipped). */
export function visibleAssets(
  assets: IPostAssetResponse[] | undefined,
): Array<IPostAssetResponse & { url: string }> {
  return (assets ?? [])
    .filter((asset): asset is IPostAssetResponse & { url: string } =>
      Boolean(asset.url),
    )
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Swipeable image gallery: native scroll-snap (swipe on touch, wheel/trackpad
 * elsewhere) plus prev/next buttons on hover-capable devices and dots.
 */
export function ImageCarousel({
  assets,
  variant = 'feed',
  className,
}: ImageCarouselProps) {
  const images = visibleAssets(assets);
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [ratio, setRatio] = useState(1);
  const count = images.length;

  const applyRatio = useCallback((image: HTMLImageElement) => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const natural = image.naturalWidth / image.naturalHeight;
    setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, natural)));
  }, []);

  const firstImageRef = useCallback(
    (node: HTMLImageElement | null) => {
      // Cached images can finish loading before React attaches `onLoad`.
      if (node?.complete) applyRatio(node);
    },
    [applyRatio],
  );

  // Keep the dots in sync with swipes.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (track.clientWidth === 0) return;
        setIndex(Math.round(track.scrollLeft / track.clientWidth));
      });
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener('scroll', onScroll);
    };
  }, []);

  const goTo = useCallback(
    (target: number) => {
      const track = trackRef.current;
      if (!track) return;
      const next = Math.min(count - 1, Math.max(0, target));
      track.scrollTo({ left: next * track.clientWidth, behavior: 'smooth' });
    },
    [count],
  );

  if (count === 0) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goTo(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      goTo(index + 1);
    }
  };

  const style = { '--ratio': ratio } as CSSProperties;

  return (
    <div
      className={cx(styles.carousel, styles[variant], className)}
      style={style}
      role="group"
      aria-roledescription="carousel"
      aria-label="Post photos"
    >
      <div
        ref={trackRef}
        className={styles.track}
        tabIndex={count > 1 ? 0 : undefined}
        onKeyDown={count > 1 ? onKeyDown : undefined}
      >
        {images.map((asset, position) => (
          <div
            key={asset.assetId}
            className={styles.slide}
            role="group"
            aria-roledescription="slide"
            aria-label={`${position + 1} of ${count}`}
          >
            <img
              ref={position === 0 ? firstImageRef : undefined}
              src={asset.url}
              alt={`Photo ${position + 1} of ${count}`}
              className={styles.image}
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={
                position === 0
                  ? (event: SyntheticEvent<HTMLImageElement>) =>
                      applyRatio(event.currentTarget)
                  : undefined
              }
            />
          </div>
        ))}
      </div>

      {count > 1 && (
        <>
          <span className={styles.counter} aria-hidden="true">
            {index + 1}/{count}
          </span>
          {index > 0 && (
            <button
              type="button"
              className={cx(styles.nav, styles.prev)}
              aria-label="Previous photo"
              onClick={() => goTo(index - 1)}
            >
              <ChevronLeft size={20} />
            </button>
          )}
          {index < count - 1 && (
            <button
              type="button"
              className={cx(styles.nav, styles.next)}
              aria-label="Next photo"
              onClick={() => goTo(index + 1)}
            >
              <ChevronRight size={20} />
            </button>
          )}
          <div className={styles.dots} aria-hidden="true">
            {images.map((asset, position) => (
              <span
                key={asset.assetId}
                className={cx(styles.dot, position === index && styles.active)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
