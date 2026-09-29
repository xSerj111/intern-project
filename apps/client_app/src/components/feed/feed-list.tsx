'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

import type {
  FeedType,
  IFeedItem,
  IRepostResponse,
  MediaTypeFilter,
  PostSort,
} from '@repo/contracts';

import { getFeed } from '../../lib/api/feed';
import { useAuth } from '../../lib/auth/auth-context';
import { ErrorState, LoadingState } from '../common/async-state';
import { PostCard } from './post-card';

import styles from './feed-list.module.css';

const PAGE_SIZE = 20;

function isRepost(item: IFeedItem): item is IRepostResponse {
  return 'repostAuthor' in item;
}

export interface FeedListProps {
  feed?: FeedType;
  sort?: PostSort;
  mediaType?: MediaTypeFilter;
}

/** Home/Feed section: paginated list of posts (and re-posts) for the viewer. */
export function FeedList({
  feed = 'following',
  sort = 'newest',
  mediaType,
}: FeedListProps) {
  const { accessToken, isHydrated, isSignedIn } = useAuth();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['feed', feed, sort, mediaType, accessToken],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      getFeed({
        feed,
        sort,
        mediaType,
        page: pageParam,
        limit: PAGE_SIZE,
        token: accessToken,
        signal,
      }),
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.page * lastPage.limit;
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
    enabled: isHydrated && Boolean(accessToken),
  });

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;

  // Progressive pagination: load the next page when the sentinel scrolls in.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  if (!isHydrated) {
    return <LoadingState label="Loading your session…" />;
  }

  if (!isSignedIn) {
    return (
      <div className={styles.empty}>
        <p className="muted">
          {feed === 'discover'
            ? 'Sign in to discover what people are sharing.'
            : 'Sign in to see posts from people you follow.'}
        </p>
        <Link href="/login" className="button">
          Sign in
        </Link>
      </div>
    );
  }

  if (query.isPending) {
    return <LoadingState label="Loading your feed…" />;
  }

  if (query.isError) {
    return (
      <ErrorState
        message="We couldn't load your feed. Retrying automatically…"
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  // Posts and reposts are paged separately by the API, so pages can overlap.
  const seen = new Set<string>();
  const items = query.data.pages
    .flatMap((page) => page.items)
    .filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)));

  if (items.length === 0) {
    return (
      <p className={`muted ${styles.empty}`}>
        {feed === 'discover'
          ? 'No public posts yet. Be the first to share something!'
          : 'Your feed is empty. Follow people to see their posts here.'}
      </p>
    );
  }

  return (
    <>
      <ul className={styles.list}>
        {items.map((item) =>
          isRepost(item) ? (
            <li key={item.id} className={styles.repostWrapper}>
              <p className={`muted ${styles.repostAttribution}`}>
                Reposted by {item.repostAuthor.displayName || item.repostAuthor.username}
              </p>
              {item.post ? (
                <PostCard post={item.post} />
              ) : (
                <p className={`muted ${styles.unavailable}`}>
                  This post is no longer available.
                </p>
              )}
            </li>
          ) : (
            <li key={item.id}>
              <PostCard post={item} />
            </li>
          ),
        )}
      </ul>

      <div ref={sentinelRef} aria-hidden="true" />
      {isFetchingNextPage && (
        <p className={`muted ${styles.loadingMore}`}>Loading more posts…</p>
      )}
    </>
  );
}
