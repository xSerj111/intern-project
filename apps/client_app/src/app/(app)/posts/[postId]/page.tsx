'use client';

import { useQuery } from '@tanstack/react-query';
import { FileX } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { PostDetail } from '../../../../components/posts/post-detail';
import { buttonClassName, Button } from '../../../../components/ui/button';
import { EmptyState } from '../../../../components/ui/empty-state';
import { Skeleton, SkeletonGroup } from '../../../../components/ui/skeleton';
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
  const { getAccessToken, isHydrated, user } = useAuth();

  const query = useQuery({
    queryKey: [...postKeys.detail(postId), user?.id ?? null],
    queryFn: ({ signal }) =>
      getPost(postId, { token: getAccessToken(), signal }),
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
    body = (
      <SkeletonGroup label="Loading post…" className={styles.loading}>
        <Skeleton height="auto" radius="md" className={styles.loadingMedia} />
        <div className={styles.loadingLines}>
          <Skeleton width="40%" height={14} />
          <Skeleton width="85%" height={12} />
          <Skeleton width="60%" height={12} />
        </div>
      </SkeletonGroup>
    );
  } else if (query.isError && isUnavailable(query.error)) {
    body = (
      <EmptyState
        icon={FileX}
        title="This content is no longer available"
        description="The post may have been deleted, or you may not have access to it."
        action={
          <Link href="/" className={buttonClassName()}>
            Back to Home
          </Link>
        }
      />
    );
  } else if (query.isError) {
    body = (
      <div className={styles.error} role="alert">
        <p>We couldn&apos;t load this post.</p>
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
  } else {
    body = <PostDetail post={query.data} />;
  }

  return (
    <div className={styles.page}>
      <h1 className="visually-hidden">Post</h1>
      {body}
    </div>
  );
}
