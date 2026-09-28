'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { searchPosts } from '../../lib/api/search';
import { useAuth } from '../../lib/auth/auth-context';
import { ErrorState, LoadingState } from '../../components/common/async-state';
import { PostCard } from '../../components/feed/post-card';

import styles from './page.module.css';

/** Minimum keyword length accepted by the API (FR-022). */
const MIN_KEYWORD_LENGTH = 3;
const PAGE_SIZE = 20;

/**
 * Dedicated post search (FR-020/021/022): a keyword prompt, paginated results
 * reusing `PostCard`, and a friendly no-results state.
 */
export default function SearchPage() {
  const { accessToken } = useAuth();
  const [input, setInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const trimmed = input.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_KEYWORD_LENGTH;

  const {
    data,
    isPending,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['search', keyword, accessToken],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      searchPosts({
        keyword,
        page: pageParam,
        limit: PAGE_SIZE,
        token: accessToken,
        signal,
      }),
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.page * lastPage.limit;
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
    enabled: keyword.length >= MIN_KEYWORD_LENGTH,
  });

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

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (trimmed.length >= MIN_KEYWORD_LENGTH) {
      setKeyword(trimmed);
    }
  }

  const items = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <main className={`container ${styles.page}`}>
      <h1 className={styles.title}>Search posts</h1>

      <form className={styles.form} role="search" onSubmit={onSubmit}>
        <input
          type="search"
          className={`input ${styles.input}`}
          placeholder="Search posts…"
          aria-label="Search posts"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <button
          type="submit"
          className="button"
          disabled={trimmed.length < MIN_KEYWORD_LENGTH}
        >
          Search
        </button>
      </form>

      {tooShort && (
        <p className={`muted ${styles.hint}`} role="status">
          Enter at least {MIN_KEYWORD_LENGTH} characters to search.
        </p>
      )}

      {keyword.length >= MIN_KEYWORD_LENGTH && isPending && (
        <LoadingState label="Searching posts…" />
      )}

      {keyword.length >= MIN_KEYWORD_LENGTH && isError && (
        <ErrorState
          message="We couldn't run your search. Retrying automatically…"
          onRetry={() => {
            void refetch();
          }}
        />
      )}

      {keyword.length >= MIN_KEYWORD_LENGTH &&
        !isPending &&
        !isError &&
        items.length === 0 && (
          <p className={`muted ${styles.empty}`}>
            No posts match “{keyword}”. Try a different keyword.
          </p>
        )}

      {items.length > 0 && (
        <>
          <ul className={styles.list}>
            {items.map((post) => (
              <li key={post.id}>
                <PostCard post={post} />
              </li>
            ))}
          </ul>
          <div ref={sentinelRef} aria-hidden="true" />
          {isFetchingNextPage && (
            <p className={`muted ${styles.loadingMore}`}>Loading more posts…</p>
          )}
        </>
      )}
    </main>
  );
}
