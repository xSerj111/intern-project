'use client';

import { useMutation } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import type { ICommentResponse } from '@repo/contracts';

import { useAuth } from '../../lib/auth/auth-context';
import { cx } from '../../lib/cx';
import { LikeButton } from '../likes/like-button';
import { MentionInput } from '../mentions/mention-input';
import { MentionText } from '../mentions/mention-text';
import { Avatar } from '../ui/avatar';
import { Button, IconButton } from '../ui/button';
import { RelativeTime } from '../ui/relative-time';

import { createComment, updateComment } from './comments-api';
import { countReplies, MAX_COMMENT_DEPTH, type CommentNode } from './comment-tree';
import styles from './post-comments.module.css';

export const COMMENT_MAX_LENGTH = 300;
const DELETED_AUTHOR = 'Deleted user';

interface CommentItemProps {
  node: CommentNode;
  /** Refresh the list and the post's comment count after a change. */
  onChanged: () => Promise<unknown>;
  onDelete: (comment: ICommentResponse) => void;
}

/** One comment with reply, edit (author only), delete and its collapsible replies. */
export function CommentItem({ node, onChanged, onDelete }: CommentItemProps) {
  const { comment, depth, replies } = node;
  const { author } = comment;
  const { getAccessToken, isSignedIn, user } = useAuth();
  const [mode, setMode] = useState<'view' | 'reply' | 'edit'>('view');
  const [draft, setDraft] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  const isOwn = Boolean(user) && comment.authorId === user?.id;
  const name = author?.displayName || author?.username || DELETED_AUTHOR;
  const edited = comment.updatedAt !== comment.createdAt;
  const replyCount = countReplies(node);

  const reply = useMutation({
    mutationFn: (content: string) =>
      createComment(
        { postId: comment.postId, content, parentId: comment.id },
        { token: getAccessToken() },
      ),
    onSuccess: async () => {
      setMode('view');
      setCollapsed(false);
      await onChanged();
    },
  });

  const edit = useMutation({
    mutationFn: (content: string) =>
      updateComment(comment.id, { content }, { token: getAccessToken() }),
    onSuccess: async () => {
      setMode('view');
      await onChanged();
    },
  });

  const active = mode === 'edit' ? edit : reply;
  const text = draft.trim();
  const canSubmit =
    text.length > 0 &&
    !active.isPending &&
    (mode !== 'edit' || text !== comment.content.trim());

  function open(next: 'reply' | 'edit') {
    reply.reset();
    edit.reset();
    setDraft(next === 'edit' ? comment.content : '');
    setMode(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    if (mode === 'edit') edit.mutate(text);
    else reply.mutate(text);
  }

  return (
    <li className={styles.item}>
      <div className={styles.comment}>
        <Avatar src={author?.avatarUrl} name={name} size="sm" decorative />
        <div className={styles.body}>
          {mode === 'edit' ? null : (
            <p className={styles.text}>
              {author ? (
                <Link href={`/profile/${author.userId}`} className={styles.name}>
                  {name}
                </Link>
              ) : (
                <span className={styles.name}>{name}</span>
              )}{' '}
              <MentionText text={comment.content} />
            </p>
          )}
          {mode === 'edit' ? (
            <form className={styles.editor} onSubmit={submit}>
              <MentionInput
                multiline
                aria-label="Edit comment"
                rows={2}
                value={draft}
                maxLength={COMMENT_MAX_LENGTH}
                onValueChange={setDraft}
                autoFocus
              />
              <EditorActions
                submitLabel="Save"
                busy={edit.isPending}
                disabled={!canSubmit}
                onCancel={() => setMode('view')}
              />
            </form>
          ) : (
            <div className={styles.meta}>
              <RelativeTime value={comment.createdAt} />
              {edited && <span>· edited</span>}
              {isSignedIn && (
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => (mode === 'reply' ? setMode('view') : open('reply'))}
                >
                  Reply
                </button>
              )}
              {isOwn && (
                <>
                  <IconButton
                    label="Edit comment"
                    size="sm"
                    className={styles.iconAction}
                    onClick={() => open('edit')}
                  >
                    <Pencil size={16} />
                  </IconButton>
                  <IconButton
                    label="Delete comment"
                    size="sm"
                    className={cx(styles.iconAction, styles.delete)}
                    onClick={() => onDelete(comment)}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </>
              )}
            </div>
          )}
          {mode === 'edit' && edit.isError && (
            <p className={styles.error} role="alert">
              Couldn&apos;t save your changes.
            </p>
          )}
        </div>
        {mode !== 'edit' && (
          <LikeButton
            target="comment"
            targetId={comment.id}
            initialLiked={comment.likedByMe}
            initialCount={comment.likeCount}
            variant="compact"
          />
        )}
      </div>

      {mode === 'reply' && (
        <form className={cx(styles.replyForm)} onSubmit={submit}>
          <MentionInput
            inputClassName={styles.input}
            value={draft}
            onValueChange={setDraft}
            maxLength={COMMENT_MAX_LENGTH}
            placeholder={`Reply to ${name}…`}
            aria-label={`Reply to ${name}`}
            autoFocus
          />
          <EditorActions
            submitLabel="Reply"
            busy={reply.isPending}
            disabled={!canSubmit}
            onCancel={() => setMode('view')}
          />
          {reply.isError && (
            <p className={styles.error} role="alert">
              Couldn&apos;t post your reply.
            </p>
          )}
        </form>
      )}

      {replyCount > 0 && (
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          {collapsed
            ? `View ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`
            : `Hide ${replyCount === 1 ? 'reply' : 'replies'}`}
        </button>
      )}
      {replies.length > 0 && !collapsed && (
        <ul
          className={cx(
            styles.replies,
            depth >= MAX_COMMENT_DEPTH && styles.repliesFlat,
          )}
        >
          {replies.map((child) => (
            <CommentItem
              key={child.comment.id}
              node={child}
              onChanged={onChanged}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function EditorActions({
  submitLabel,
  busy,
  disabled,
  onCancel,
}: {
  submitLabel: string;
  busy: boolean;
  disabled: boolean;
  onCancel: () => void;
}) {
  return (
    <div className={styles.editorActions}>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" size="sm" loading={busy} disabled={disabled}>
        {submitLabel}
      </Button>
    </div>
  );
}
