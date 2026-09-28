'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { getPost } from '../../lib/api/posts';
import { useAuth } from '../../lib/auth/auth-context';
import { ErrorState, LoadingState } from '../common/async-state';
import { Comments } from './comments';
import { PostActions } from './post-actions';
import { PostCard } from '../feed/post-card';

import styles from './post-detail.module.css';

/** Full post view: the post, its actions and the comment thread. */
export function PostDetail({ postId }: { postId: string }) {
  const { accessToken, isHydrated } = useAuth();

  const query = useQuery({
    queryKey: ['post', postId],
    queryFn: ({ signal }) => getPost(postId, accessToken, signal),
    enabled: isHydrated,
  });

  if (!isHydrated || query.isPending) {
    return <LoadingState label="Loading post…" />;
  }

  if (query.isError) {
    const notFound =
      typeof query.error === 'object' &&
      query.error !== null &&
      'status' in query.error &&
      (query.error as { status?: number }).status === 404;

    return notFound ? (
      <p className="muted">This post could not be found.</p>
    ) : (
      <ErrorState
        message="We couldn't load this post."
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const post = query.data;

  return (
    <div className={styles.page}>
      <Link href="/" className={`muted ${styles.back}`}>
        ← Back to feed
      </Link>

      <section aria-label="Post">
        <PostCard post={post} />
        <div className={styles.actions}>
          <PostActions post={post} />
        </div>
      </section>

      <Comments postId={post.id} />
    </div>
  );
}
