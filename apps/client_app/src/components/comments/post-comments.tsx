'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';

import type { ICommentResponse } from '@repo/contracts';

import { postKeys } from '../../lib/api/posts';
import { useAuth } from '../../lib/auth/auth-context';
import { cx } from '../../lib/cx';
import { LikeButton } from '../likes/like-button';
import { Avatar } from '../ui/avatar';
import { Button, IconButton } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { RelativeTime } from '../ui/relative-time';
import { Skeleton, SkeletonGroup } from '../ui/skeleton';

import {
  commentKeys,
  createComment,
  deleteComment,
  getPostComments,
} from './comments-api';
import styles from './post-comments.module.css';

const MAX_LENGTH = 300;
const DELETED_AUTHOR = 'Deleted user';

interface PostCommentsProps {
  postId: string;
  /** Rendered above the first comment inside the scrolling area (e.g. the caption). */
  intro?: ReactNode;
  /** The list scrolls on its own and the form stays pinned (desktop detail layout). */
  scrollable?: boolean;
  className?: string;
}

function CommentRow({
  comment,
  isOwn,
  onDelete,
}: {
  comment: ICommentResponse;
  isOwn: boolean;
  onDelete: (comment: ICommentResponse) => void;
}) {
  const { author } = comment;
  const name = author?.displayName || author?.username || DELETED_AUTHOR;

  return (
    <li className={styles.comment}>
      <Avatar src={author?.avatarUrl} name={name} size="sm" decorative />
      <div className={styles.body}>
        <p className={styles.text}>
          {author ? (
            <Link href={`/profile/${author.userId}`} className={styles.name}>
              {name}
            </Link>
          ) : (
            <span className={styles.name}>{name}</span>
          )}{' '}
          {comment.content}
        </p>
        <div className={styles.meta}>
          <RelativeTime value={comment.createdAt} />
          {isOwn && (
            <IconButton
              label="Delete comment"
              size="sm"
              className={styles.delete}
              onClick={() => onDelete(comment)}
            >
              <Trash2 size={16} />
            </IconButton>
          )}
        </div>
      </div>
      <LikeButton
        target="comment"
        targetId={comment.id}
        initialLiked={comment.likedByMe}
        initialCount={comment.likeCount}
        variant="compact"
      />
    </li>
  );
}

/** A post's comments with author avatars, own-comment deletion and a composer. */
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
        {comments.length > 0 && (
          <ul className={styles.list}>
            {comments.map((comment) => (
              <CommentRow
                key={comment.id}
                comment={comment}
                isOwn={Boolean(user) && comment.authorId === user?.id}
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
            <input
              className={styles.input}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={MAX_LENGTH}
              placeholder="Add a comment…"
              aria-label="Add a comment"
              autoComplete="off"
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

      <Dialog
        open={pendingDelete !== null}
        onClose={() => !remove.isPending && setPendingDelete(null)}
        title="Delete comment?"
        description="This can't be undone."
        size="sm"
        flush={!remove.isError}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => pendingDelete && remove.mutate(pendingDelete.id)}
            >
              Delete
            </Button>
          </>
        }
      >
        {remove.isError && (
          <p className={styles.error} role="alert">
            Couldn&apos;t delete the comment. Try again.
          </p>
        )}
      </Dialog>
    </section>
  );
}
