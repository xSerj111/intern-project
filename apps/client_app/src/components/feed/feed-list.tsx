'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import type { IPostResponse } from '@repo/contracts';

import { getFeed } from '../../lib/api/feed';
import { useAuth } from '../../lib/auth/auth-context';
import { ErrorState, LoadingState } from '../common/async-state';

import styles from './feed-list.module.css';

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function PostCard({ post }: { post: IPostResponse }) {
  return (
    <li className={styles.post}>
      <div className={styles.postHeader}>
        <span className={styles.author}>{post.authorId}</span>
        <time className={styles.time} dateTime={post.createdAt}>
          {formatDate(post.createdAt)}
        </time>
      </div>
      <p className={styles.content}>{post.content}</p>
    </li>
  );
}

/** Home/Feed section: renders the authenticated user's feed posts. */
export function FeedList() {
  const { accessToken, isHydrated, isSignedIn } = useAuth();

  const query = useQuery({
    queryKey: ['feed', accessToken],
    queryFn: ({ signal }) => getFeed({ token: accessToken, signal }),
    enabled: isHydrated && Boolean(accessToken),
  });

  if (!isHydrated) {
    return <LoadingState label="Loading your session…" />;
  }

  if (!isSignedIn) {
    return (
      <div className={styles.empty}>
        <p className="muted">Sign in to see posts from people you follow.</p>
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

  const { items } = query.data;

  if (items.length === 0) {
    return (
      <p className={`muted ${styles.empty}`}>
        Your feed is empty. Follow people to see their posts here.
      </p>
    );
  }

  return (
    <ul className={styles.list}>
      {items.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </ul>
  );
}
