'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { PostStatus } from '@repo/contracts';

import { archivePost, deletePost, getPost } from '../../lib/api/posts';
import { useAuth } from '../../lib/auth/auth-context';
import { ErrorState, LoadingState } from '../common/async-state';
import { Comments } from './comments';
import { PostActions } from './post-actions';
import { PostForm } from './post-form';
import { PostCard } from '../feed/post-card';

import styles from './post-detail.module.css';

/** Full post view: the post, actions, owner controls and the comment thread. */
export function PostDetail({ postId }: { postId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, user, isHydrated } = useAuth();
  const [isEditing, setIsEditing] = useState(false);

  const query = useQuery({
    queryKey: ['post', postId],
    queryFn: ({ signal }) => getPost(postId, accessToken, signal),
    enabled: isHydrated,
  });

  const archiveMutation = useMutation({
    mutationFn: () => archivePost(accessToken, postId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['post', postId] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deletePost(accessToken, postId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      router.push('/');
    },
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
  const isOwner = user?.id === post.author.id;

  return (
    <div className={styles.page}>
      <Link href="/" className={`muted ${styles.back}`}>
        ← Back to feed
      </Link>

      {isEditing ? (
        <section className="card" aria-label="Edit post">
          <PostForm
            initialPost={post}
            onSuccess={() => {
              setIsEditing(false);
              void queryClient.invalidateQueries({
                queryKey: ['post', postId],
              });
              void queryClient.invalidateQueries({ queryKey: ['feed'] });
            }}
          />
        </section>
      ) : (
        <section aria-label="Post">
          <PostCard post={post} />
          <div className={styles.actions}>
            <PostActions post={post} />
            {isOwner && (
              <div className={styles.ownerActions}>
                <button
                  type="button"
                  className={styles.ownerButton}
                  onClick={() => setIsEditing(true)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={styles.ownerButton}
                  disabled={archiveMutation.isPending || post.status !== PostStatus.Published}
                  onClick={() => archiveMutation.mutate()}
                >
                  Archive
                </button>
                <button
                  type="button"
                  className={`${styles.ownerButton} ${styles.danger}`}
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    if (window.confirm('Delete this post? This cannot be undone.')) {
                      deleteMutation.mutate();
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      <Comments postId={post.id} />
    </div>
  );
}
