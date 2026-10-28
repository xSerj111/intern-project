'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';

import type { IFeedPage, IPostResponse } from '@repo/contracts';

import { getFeed } from '../../lib/api/feed';
import { postKeys } from '../../lib/api/posts';
import { useAuth } from '../../lib/auth/auth-context';
import { PostCard } from '../posts/post-card';
import { Button, buttonClassName } from '../ui/button';
import { EmptyState } from '../ui/empty-state';
import { PostSkeleton, SkeletonGroup } from '../ui/skeleton';
import { Spinner } from '../ui/spinner';

import styles from './feed-list.module.css';

const PAGE_SIZE = 10;

function FeedSkeletons({ count }: { count: number }) {
  return (
    <SkeletonGroup label="Loading your feed…" className={styles.skeletons}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={styles.skeletonCard}>
          <PostSkeleton />
        </div>
      ))}
    </SkeletonGroup>
  );
}

function fetchHomePage(
  cursor?: string,
  token?: string | null,
  signal?: AbortSignal,
): Promise<IFeedPage> {
  return getFeed({ cursor, limit: PAGE_SIZE, token, signal });
}

interface FeedListProps {
  /**
   * Query key prefix; the user id is appended. Keep it under `postKeys.all`
   * so post mutations (create, delete, comment, profile edit) refetch it.
   * Defaults to the home feed key.
   */
  queryKey?: readonly unknown[];
  /** Loads one page; defaults to the home feed (`GET /posts/feed`). */
  fetchPage?: (cursor?: string, token?: string | null) => Promise<IFeedPage>;
  /** Shown when the first page has no posts; defaults to the home feed text. */
  emptyState?: ReactNode;
}

/**
 * Signed-in user's posts, loaded page by page while scrolling. Home feed by
 * default; pass `queryKey` and `fetchPage` to list any other post feed.
 */
export function FeedList({
  queryKey,
  fetchPage,
  emptyState,
}: FeedListProps = {}) {
  const { getAccessToken, isHydrated, isSignedIn, user } = useAuth();
  const sentinel = useRef<HTMLDivElement>(null);
  // A custom feed (e.g. a tag page) is public; only the home feed needs login.
  const isCustom = fetchPage !== undefined;

  const query = useInfiniteQuery({
    queryKey: [...(queryKey ?? postKeys.feed()), user?.id ?? null],
    queryFn: ({ pageParam, signal }) =>
      fetchPage
        ? fetchPage(pageParam, getAccessToken())
        : fetchHomePage(pageParam, getAccessToken(), signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: isHydrated && (isCustom || isSignedIn),
  });

  const {
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = query;

  // Load the next page shortly before the sentinel scrolls into view.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage || isFetchNextPageError) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void fetchNextPage();
        }
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchNextPageError, isFetchingNextPage, fetchNextPage]);

  // Posts can shift between pages while new ones arrive; drop repeats.
  const posts = useMemo(() => {
    const seen = new Set<string>();
    const unique: IPostResponse[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const post of page.items) {
        if (!seen.has(post.id)) {
          seen.add(post.id);
          unique.push(post);
        }
      }
    }
    return unique;
  }, [query.data]);

  if (!isHydrated) {
    return <FeedSkeletons count={2} />;
  }

  if (!isCustom && !isSignedIn) {
    return (
      <EmptyState
        icon={Camera}
        title="Welcome to Innogram"
        description="Log in to see photos and posts from the people you follow."
        action={
          <div className={styles.actions}>
            <Link href="/login" className={buttonClassName()}>
              Log in
            </Link>
            <Link
              href="/signup"
              className={buttonClassName({ variant: 'secondary' })}
            >
              Sign up
            </Link>
          </div>
        }
      />
    );
  }

  if (query.isPending) {
    return <FeedSkeletons count={3} />;
  }

  if (query.isError && posts.length === 0) {
    return (
      <div className={styles.error} role="alert">
        <p>We couldn&apos;t load your feed.</p>
        <Button
          variant="secondary"
          onClick={() => {
            void query.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      emptyState ?? (
        <EmptyState
          icon={Camera}
          title="Follow people to fill your feed"
          description="Posts from the people you follow will show up here."
        />
      )
    );
  }

  return (
    <>
      <ul className={styles.list}>
        {posts.map((post) => (
          <li key={post.id}>
            <PostCard post={post} />
          </li>
        ))}
      </ul>

      <div ref={sentinel} className={styles.sentinel} aria-hidden="true" />

      {isFetchingNextPage && (
        <div className={styles.more} role="status">
          <Spinner size={22} label="Loading more posts" />
        </div>
      )}
      {isFetchNextPageError && (
        <div className={styles.error} role="alert">
          <p>We couldn&apos;t load more posts.</p>
          <Button
            variant="secondary"
            onClick={() => {
              void fetchNextPage();
            }}
          >
            Try again
          </Button>
        </div>
      )}
      {!hasNextPage && !isFetchingNextPage && (
        <p className={styles.end}>You&apos;re all caught up</p>
      )}
    </>
  );
}
