'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

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

const FEEDS = FEED_TABS.map((tab) => tab.value);
const SORTS = SORT_OPTIONS.map((option) => option.value);
const MEDIA = MEDIA_FILTERS.map((option) => option.value);

function pick<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

/**
 * Following/Discover tabs plus sort and media-type filters (FR-017/018/019/023).
 * State lives in the URL (`?feed&sort&mediaType`) so it survives refresh and
 * back navigation; changing a control refetches the first page.
 */
export function FeedTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const feed = pick(searchParams.get('feed'), FEEDS) ?? 'following';
  const sort = pick(searchParams.get('sort'), SORTS) ?? 'newest';
  const mediaType = pick(searchParams.get('mediaType'), MEDIA);

  function update(next: {
    feed?: FeedType;
    sort?: PostSort;
    mediaType?: MediaTypeFilter;
  }) {
    const merged = { feed, sort, mediaType, ...next };
    const params = new URLSearchParams();
    if (merged.feed !== 'following') params.set('feed', merged.feed);
    if (merged.sort !== 'newest') params.set('sort', merged.sort);
    if (merged.mediaType) params.set('mediaType', merged.mediaType);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

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
            onClick={() => update({ feed: tab.value })}
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
            onChange={(event) =>
              update({ sort: event.target.value as PostSort })
            }
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
              update({
                mediaType: (event.target.value || undefined) as
                  | MediaTypeFilter
                  | undefined,
              })
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
              update({ sort: 'newest', mediaType: undefined });
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
