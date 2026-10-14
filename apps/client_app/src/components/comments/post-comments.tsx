'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { useAuth } from '../../lib/auth/auth-context';
import { ErrorState, LoadingState } from '../common/async-state';
import { LikeButton } from '../likes/like-button';

import { commentKeys, createComment, getPostComments } from './comments-api';
import styles from './post-comments.module.css';

const MAX_LENGTH = 300;

/** Comment list for one post, with a like button per comment and a minimal composer. */
export function PostComments({ postId }: { postId: string }) {
  const { accessToken, isHydrated, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');

  const query = useQuery({
    queryKey: [...commentKeys.post(postId), accessToken],
    queryFn: ({ signal }) =>
      getPostComments(postId, { token: accessToken, signal }),
    enabled: isHydrated,
  });

  const post = useMutation({
    mutationFn: (text: string) =>
      createComment({ postId, content: text }, { token: accessToken }),
    onSuccess: () => {
      setContent('');
      return queryClient.invalidateQueries({
        queryKey: commentKeys.post(postId),
      });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = content.trim();
    if (text && !post.isPending) {
      post.mutate(text);
    }
  }

  return (
    <section className={styles.comments} aria-label="Comments">
      {query.isPending && <LoadingState label="Loading comments…" />}
      {query.isError && (
        <ErrorState
          message="We couldn't load the comments."
          onRetry={() => {
            void query.refetch();
          }}
        />
      )}
      {query.isSuccess && query.data.length === 0 && (
        <p className="muted">No comments yet.</p>
      )}
      {query.isSuccess && query.data.length > 0 && (
        <ul className={styles.list}>
          {query.data.map((comment) => (
            <li key={comment.id} className={styles.comment}>
              <span className={styles.author}>{comment.authorId}</span>
              <p className={styles.content}>{comment.content}</p>
              <LikeButton
                target="comment"
                targetId={comment.id}
                initialLiked={comment.likedByMe}
                initialCount={comment.likeCount}
              />
            </li>
          ))}
        </ul>
      )}

      {isSignedIn ? (
        <form className={styles.form} onSubmit={submit}>
          <input
            className={styles.input}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            maxLength={MAX_LENGTH}
            placeholder="Write a comment…"
            aria-label="Write a comment"
          />
          <button
            type="submit"
            className="button"
            disabled={post.isPending || content.trim().length === 0}
          >
            Post
          </button>
        </form>
      ) : (
        isHydrated && <p className="muted">Sign in to comment.</p>
      )}
      {post.isError && (
        <p className={styles.error} role="alert">
          Couldn&apos;t post your comment.
        </p>
      )}
    </section>
  );
}
