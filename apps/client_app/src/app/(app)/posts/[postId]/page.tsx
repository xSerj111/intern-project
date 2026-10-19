'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import {
  ErrorState,
  LoadingState,
} from '../../../../components/common/async-state';
import { PostCard } from '../../../../components/feed/feed-list';
import { ApiError } from '../../../../lib/api/client';
import { getPost, postKeys } from '../../../../lib/api/posts';
import { useAuth } from '../../../../lib/auth/auth-context';

import styles from './page.module.css';

/** Statuses meaning the post is gone, hidden from the viewer, or the id is malformed. */
const UNAVAILABLE = new Set([400, 403, 404]);

function isUnavailable(error: unknown): boolean {
  return error instanceof ApiError && UNAVAILABLE.has(error.status);
}

/** Landing page for notification and email links (`/posts/{postId}`). */
export default function PostPage() {
  const { postId } = useParams<{ postId: string }>();
  const { accessToken, isHydrated } = useAuth();

  const query = useQuery({
    queryKey: [...postKeys.detail(postId), accessToken],
    queryFn: ({ signal }) => getPost(postId, { token: accessToken, signal }),
    enabled: isHydrated,
    // A missing post will not reappear on retry, so skip the default retry/poll.
    retry: (count, error) => !isUnavailable(error) && count < 2,
    refetchInterval: (q) =>
      q.state.status === 'error' && !isUnavailable(q.state.error)
        ? 5000
        : false,
  });

  let body;
  if (!isHydrated || query.isPending) {
    body = <LoadingState label="Loading post…" />;
  } else if (query.isError && isUnavailable(query.error)) {
    body = (
      <div className={styles.unavailable}>
        <p>This content is no longer available</p>
        <Link href="/" className="button">
          Back to Home
        </Link>
      </div>
    );
  } else if (query.isError) {
    body = (
      <ErrorState
        message="We couldn't load this post."
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  } else {
    body = (
      <ul className={styles.list}>
        <PostCard post={query.data} commentsOpen />
      </ul>
    );
  }

  return (
    <div className={`container ${styles.page}`}>
      <h1 className={styles.title}>Post</h1>
      {body}
    </div>
  );
}
