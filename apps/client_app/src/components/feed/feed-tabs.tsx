'use client';

import { useState } from 'react';

import type { FeedType, MediaTypeFilter, PostSort } from '@repo/contracts';

import { FeedList } from './feed-list';

import styles from './feed-tabs.module.css';

const FEED_TABS: { value: FeedType; label: string }[] = [
  { value: 'following', label: 'Following' },
  { value: 'discover', label: 'Discover' },
];

const SORT_OPTIONS: { value: PostSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'most_liked', label: 'Most liked' },
];

const MEDIA_FILTERS: { value: MediaTypeFilter; label: string }[] = [
  { value: 'photos', label: 'Photos' },
  { value: 'videos', label: 'Videos' },
  { value: 'text', label: 'Text' },
];

/**
 * Following/Discover tabs plus sort and media-type filters (FR-017/018/019/023).
 * Changing any control resets the feed query, which refetches the first page.
 */
export function FeedTabs() {
  const [feed, setFeed] = useState<FeedType>('following');
  const [sort, setSort] = useState<PostSort>('newest');
  const [mediaType, setMediaType] = useState<MediaTypeFilter | undefined>();

  const hasActiveFilter = sort !== 'newest' || mediaType !== undefined;

  return (
    <div className={styles.wrapper}>
      <div className={styles.tabs} role="tablist" aria-label="Feed views">
        {FEED_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={feed === tab.value}
            className={
              feed === tab.value
                ? `${styles.tab} ${styles.tabActive}`
                : styles.tab
            }
            onClick={() => setFeed(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.controls}>
        <label className={styles.control}>
          <span className="muted">Sort</span>
          <select
            className="input"
            value={sort}
            onChange={(event) => setSort(event.target.value as PostSort)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.control}>
          <span className="muted">Media</span>
          <select
            className="input"
            value={mediaType ?? ''}
            onChange={(event) =>
              setMediaType((event.target.value || undefined) as
                | MediaTypeFilter
                | undefined)
            }
          >
            <option value="">All</option>
            {MEDIA_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {hasActiveFilter && (
          <button
            type="button"
            className={`button button--ghost ${styles.clear}`}
            onClick={() => {
              setSort('newest');
              setMediaType(undefined);
            }}
          >
            Clear
          </button>
        )}
      </div>

      <FeedList feed={feed} sort={sort} mediaType={mediaType} />
    </div>
  );
}
