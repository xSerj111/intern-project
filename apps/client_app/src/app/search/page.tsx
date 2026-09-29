'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';

import { searchPosts } from '../../lib/api/search';
import { useAuth } from '../../lib/auth/auth-context';
import { useDebouncedValue } from '../../lib/hooks/use-debounced-value';
import { ErrorState, LoadingState } from '../../components/common/async-state';
import { PostCard } from '../../components/feed/post-card';

import styles from './page.module.css';

/** Minimum keyword length accepted by the API (FR-022). */
const MIN_KEYWORD_LENGTH = 3;
const PAGE_SIZE = 20;
const DEBOUNCE_MS = 400;

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchContent />
    </Suspense>
  );
}

/**
 * Dedicated post search (FR-020/021/022): the keyword lives in `?q=`, is
 * searched as you type (debounced) or on submit, and results reuse `PostCard`.
 */
function SearchContent() {
  const { accessToken } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const keyword = (useSearchParams().get('q') ?? '').trim();
  const [input, setInput] = useState(keyword);
  // The last keyword this page wrote to the URL, to tell it apart from external changes.
  const lastPushed = useRef(keyword);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const trimmed = input.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_KEYWORD_LENGTH;
  const debounced = useDebouncedValue(trimmed, DEBOUNCE_MS);

  function setKeyword(next: string) {
    if (next === keyword) return;
    lastPushed.current = next;
    router.replace(
      next ? `${pathname}?q=${encodeURIComponent(next)}` : pathname,
      { scroll: false },
    );
  }

  // Back/forward or a nav link changed `?q=` from outside: mirror it in the box.
  useEffect(() => {
    if (keyword !== lastPushed.current) {
      lastPushed.current = keyword;
      setInput(keyword);
    }
  }, [keyword]);

  // Search as you type once the input settles; clearing the box clears the URL.
  useEffect(() => {
    if (debounced.length >= MIN_KEYWORD_LENGTH || debounced.length === 0) {
      setKeyword(debounced);
    }
  }, [debounced]);

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
                <PostCard post={post} highlight={keyword} />
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
