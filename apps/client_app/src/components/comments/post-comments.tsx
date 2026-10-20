'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';

import type { ICommentResponse } from '@repo/contracts';

import { postKeys } from '../../lib/api/posts';
import { useAuth } from '../../lib/auth/auth-context';
import { cx } from '../../lib/cx';
import { MentionInput } from '../mentions/mention-input';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { Skeleton, SkeletonGroup } from '../ui/skeleton';

import { CommentItem, COMMENT_MAX_LENGTH } from './comment-item';
import { buildCommentTree } from './comment-tree';
import {
  commentKeys,
  createComment,
  deleteComment,
  getPostComments,
} from './comments-api';
import styles from './post-comments.module.css';


interface PostCommentsProps {
  postId: string;
  /** Rendered above the first comment inside the scrolling area (e.g. the caption). */
  intro?: ReactNode;
  /** The list scrolls on its own and the form stays pinned (desktop detail layout). */
  scrollable?: boolean;
  className?: string;
}

/** A post's comment threads with replies, own-comment edit/delete and a composer. */
export function PostComments({
  postId,
  intro,
  scrollable = false,
  className,
}: PostCommentsProps) {
  const { accessToken, getAccessToken, isHydrated, isSignedIn, user } =
    useAuth();
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ICommentResponse | null>(
    null,
  );

  const query = useQuery({
    queryKey: [...commentKeys.post(postId), user?.id ?? null],
    queryFn: ({ signal }) =>
      getPostComments(postId, { token: getAccessToken(), signal }),
    enabled: isHydrated,
  });

  /** Refresh the list and the post's comment count (feed + detail). */
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: commentKeys.post(postId) }),
      queryClient.invalidateQueries({ queryKey: postKeys.all }),
    ]);

  const post = useMutation({
    mutationFn: (text: string) =>
      createComment({ postId, content: text }, { token: accessToken }),
    onSuccess: () => {
      setContent('');
      return refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (commentId: string) =>
      deleteComment(commentId, { token: getAccessToken() }),
    onSuccess: async () => {
      setPendingDelete(null);
      await refresh();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = content.trim();
    if (text && !post.isPending) {
      post.mutate(text);
    }
  }

  const comments = query.data ?? [];
  const tree = useMemo(() => buildCommentTree(comments), [comments]);

  return (
    <section
      className={cx(styles.comments, scrollable && styles.scrollable, className)}
      aria-label="Comments"
    >
      <div className={styles.scroll}>
        {intro}
        {query.isPending && (
          <SkeletonGroup label="Loading comments…" className={styles.loading}>
            {[0, 1, 2].map((key) => (
              <div key={key} className={styles.skeletonRow}>
                <Skeleton width={32} height={32} radius="full" />
                <Skeleton width={`${70 - key * 12}%`} height={12} />
              </div>
            ))}
          </SkeletonGroup>
        )}
        {query.isError && (
          <div className={styles.notice} role="alert">
            <p>We couldn&apos;t load the comments.</p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void query.refetch();
              }}
            >
              Try again
            </Button>
          </div>
        )}
        {query.isSuccess && comments.length === 0 && (
          <p className={styles.empty}>
            No comments yet. Start the conversation.
          </p>
        )}
        {tree.length > 0 && (
          <ul className={styles.list}>
            {tree.map((node) => (
              <CommentItem
                key={node.comment.id}
                node={node}
                onChanged={refresh}
                onDelete={(target) => {
                  remove.reset();
                  setPendingDelete(target);
                }}
              />
            ))}
          </ul>
        )}
      </div>

      <div className={styles.footer}>
        {isSignedIn ? (
          <form className={styles.form} onSubmit={submit}>
            <MentionInput
              inputClassName={styles.input}
              value={content}
              onValueChange={setContent}
              maxLength={COMMENT_MAX_LENGTH}
              placeholder="Add a comment…"
              aria-label="Add a comment"
            />
            <Button
              type="submit"
              variant="ghost"
              className={styles.send}
              loading={post.isPending}
              disabled={content.trim().length === 0}
            >
              Post
            </Button>
          </form>
        ) : (
          isHydrated && (
            <p className={styles.signIn}>
              <Link href="/login">Log in</Link> to comment.
            </p>
          )
        )}
        {post.isError && (
          <p className={styles.error} role="alert">
            Couldn&apos;t post your comment.
          </p>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete comment?"
        description="This can't be undone."
        confirmLabel="Delete"
        destructive
        busy={remove.isPending}
        error={remove.isError ? "Couldn't delete the comment. Try again." : null}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
