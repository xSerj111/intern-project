'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Hash, SearchX, TriangleAlert, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import type { IPostResponse } from '@repo/contracts';

import { searchProfiles } from '../../lib/api/profile';
import { searchHashtags, searchKeys, searchPosts } from '../../lib/api/search';
import { useAuth } from '../../lib/auth/auth-context';
import { PostCard } from '../posts/post-card';
import { Button, buttonClassName } from '../ui/button';
import { EmptyState } from '../ui/empty-state';
import { PostSkeleton, RowSkeleton, SkeletonGroup } from '../ui/skeleton';
import { Tabs, tabPanelProps, type TabItem } from '../ui/tabs';

import { ProfileRow } from './profile-row';
import {
  MIN_QUERY_LENGTH,
  isQueryLongEnough,
  parseTab,
  type SearchTab,
} from './search-limits';
import styles from './search-results.module.css';

const PEOPLE_LIMIT = 20;
const TAG_LIMIT = 20;
const POSTS_PAGE_SIZE = 10;
const ID_PREFIX = 'search';

const TAB_ITEMS: TabItem<SearchTab>[] = [
  { id: 'people', label: 'People' },
  { id: 'posts', label: 'Posts' },
  { id: 'tags', label: 'Tags' },
];

interface TabProps {
  /** Trimmed query. */
  q: string;
}

function QueryHint({ tab }: { tab: SearchTab }) {
  const min = MIN_QUERY_LENGTH[tab];
  return (
    <p className={styles.hint}>
      Type at least {min} character{min === 1 ? '' : 's'}
    </p>
  );
}

function ErrorState({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <EmptyState
      icon={TriangleAlert}
      title={`We couldn't load ${what}`}
      action={
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  );
}

function PeopleTab({ q }: TabProps) {
  const { getAccessToken, isSignedIn, user } = useAuth();
  const enabled = isSignedIn && isQueryLongEnough('people', q);

  const query = useQuery({
    queryKey: [...searchKeys.people(q), user?.id ?? null],
    queryFn: ({ signal }) =>
      searchProfiles({ q, limit: PEOPLE_LIMIT }, getAccessToken(), signal),
    enabled,
  });

  if (!isSignedIn) {
    return (
      <EmptyState
        icon={UserRound}
        title="Log in to search people"
        description="People search is available to signed-in users."
        action={
          <Link href="/login" className={buttonClassName()}>
            Log in
          </Link>
        }
      />
    );
  }
  if (!isQueryLongEnough('people', q)) return <QueryHint tab="people" />;
  if (query.isPending) {
    return (
      <SkeletonGroup label="Searching people…">
        <RowSkeleton count={4} />
      </SkeletonGroup>
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        what="people"
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  if (query.data.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="No people found"
        description={`Nobody matches "${q}".`}
      />
    );
  }
  return (
    <ul className={styles.rows}>
      {query.data.map((person) => (
        <li key={person.userId}>
          <ProfileRow user={person} />
        </li>
      ))}
    </ul>
  );
}

function PostsTab({ q }: TabProps) {
  const { getAccessToken, user } = useAuth();
  const enabled = isQueryLongEnough('posts', q);

  const query = useInfiniteQuery({
    queryKey: [...searchKeys.posts(q), user?.id ?? null],
    queryFn: ({ pageParam, signal }) =>
      searchPosts(
        { keyword: q, page: pageParam, limit: POSTS_PAGE_SIZE },
        getAccessToken(),
        signal,
      ),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.limit < last.total ? last.page + 1 : undefined,
    enabled,
  });

  // Offset pages can overlap when posts change between requests; drop repeats.
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

  if (!enabled) return <QueryHint tab="posts" />;
  if (query.isPending) {
    return (
      <SkeletonGroup label="Searching posts…" className={styles.skeletons}>
        {[0, 1].map((index) => (
          <div key={index} className={styles.skeletonCard}>
            <PostSkeleton />
          </div>
        ))}
      </SkeletonGroup>
    );
  }
  if (query.isError && posts.length === 0) {
    return (
      <ErrorState
        what="posts"
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  if (posts.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="No posts found"
        description={`No posts match "${q}".`}
      />
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
      {query.isFetchNextPageError && (
        <p className={styles.hint} role="alert">
          We couldn&apos;t load more posts.
        </p>
      )}
      {query.hasNextPage && (
        <div className={styles.more}>
          <Button
            variant="secondary"
            loading={query.isFetchingNextPage}
            onClick={() => {
              void query.fetchNextPage();
            }}
          >
            Load more
          </Button>
        </div>
      )}
    </>
  );
}

function TagsTab({ q }: TabProps) {
  const { getAccessToken } = useAuth();
  const tagQuery = q.startsWith('#') ? q.slice(1).trim() : q;
  const enabled = isQueryLongEnough('tags', q);

  const query = useQuery({
    queryKey: searchKeys.tags(tagQuery),
    queryFn: ({ signal }) =>
      searchHashtags(
        { q: tagQuery, limit: TAG_LIMIT },
        getAccessToken(),
        signal,
      ),
    enabled,
  });

  if (!enabled) return <QueryHint tab="tags" />;
  if (query.isPending) {
    return (
      <SkeletonGroup label="Searching tags…">
        <RowSkeleton count={4} />
      </SkeletonGroup>
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        what="tags"
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  if (query.data.length === 0) {
    return (
      <EmptyState
        icon={Hash}
        title="No tags found"
        description={`No tags match "${tagQuery}".`}
      />
    );
  }
  return (
    <ul className={styles.rows}>
      {query.data.map((hashtag) => (
        <li key={hashtag.tag}>
          <Link
            href={`/tags/${encodeURIComponent(hashtag.tag)}`}
            className={styles.tag}
          >
            <span className={styles.tagName}>#{hashtag.tag}</span>
            <span className={styles.tagCount}>
              {hashtag.postCount} {hashtag.postCount === 1 ? 'post' : 'posts'}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Results of `/search?q=&tab=`: People, Posts and Tags tabs. */
export function SearchResults() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isHydrated, isSignedIn } = useAuth();

  const q = (searchParams.get('q') ?? '').trim();
  const tab = parseTab(searchParams.get('tab'), isSignedIn);

  const selectTab = (next: SearchTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`${pathname}?${params.toString()}`);
  };

  // The default tab depends on the session, so wait for it.
  if (!isHydrated) {
    return (
      <SkeletonGroup label="Loading search…">
        <RowSkeleton count={3} />
      </SkeletonGroup>
    );
  }

  return (
    <div className={styles.root}>
      <Tabs
        items={TAB_ITEMS}
        value={tab}
        onChange={selectTab}
        label="Search results"
        idPrefix={ID_PREFIX}
        className={styles.tabs}
      />
      <div {...tabPanelProps(ID_PREFIX, tab)}>
        {tab === 'people' && <PeopleTab q={q} />}
        {tab === 'posts' && <PostsTab q={q} />}
        {tab === 'tags' && <TagsTab q={q} />}
      </div>
    </div>
  );
}
