'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  createComment,
  deleteComment,
  getCommentsByPost,
  updateComment,
} from '../../lib/api/comments';
import { useAuth } from '../../lib/auth/auth-context';
import { ErrorState, LoadingState } from '../common/async-state';

import styles from './comments.module.css';

/** Comment thread for a post: list, add, edit and delete own comments. */
export function Comments({ postId }: { postId: string }) {
  const { accessToken, user, isSignedIn } = useAuth();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');

  const query = useQuery({
    queryKey: ['comments', postId],
    queryFn: ({ signal }) => getCommentsByPost(postId, signal),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['comments', postId] });
    void queryClient.invalidateQueries({ queryKey: ['feed'] });
    void queryClient.invalidateQueries({ queryKey: ['post', postId] });
  }

  const createMutation = useMutation({
    mutationFn: (content: string) =>
      createComment(accessToken, { postId, content }),
    onSuccess: () => {
      setDraft('');
      invalidate();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      updateComment(accessToken, id, { content }),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteComment(accessToken, id),
    onSuccess: invalidate,
  });

  if (query.isPending) {
    return <LoadingState label="Loading comments…" />;
  }

  if (query.isError) {
    return (
      <ErrorState
        message="We couldn't load the comments."
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const comments = query.data;

  return (
    <section className={styles.section} aria-label="Comments">
      <h3 className={styles.heading}>Comments ({comments.length})</h3>

      {isSignedIn ? (
        <form
          className={styles.composer}
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim().length === 0) return;
            createMutation.mutate(draft.trim());
          }}
        >
          <textarea
            className={`input ${styles.textarea}`}
            value={draft}
            maxLength={300}
            rows={2}
            placeholder="Add a comment…"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="submit"
            className="button"
            disabled={createMutation.isPending || draft.trim().length === 0}
          >
            Comment
          </button>
        </form>
      ) : (
        <p className="muted">Sign in to join the conversation.</p>
      )}

      {comments.length === 0 ? (
        <p className="muted">No comments yet. Be the first!</p>
      ) : (
        <ul className={styles.list}>
          {comments.map((comment) => {
            const isAuthor = user?.id === comment.author.id;
            const isEditing = editingId === comment.id;

            return (
              <li key={comment.id} className={styles.comment}>
                <div className={styles.commentHeader}>
                  <span className={styles.authorName}>
                    {comment.author.displayName || comment.author.username}
                  </span>
                  <span className={`muted ${styles.handle}`}>
                    @{comment.author.username}
                  </span>
                </div>

                {isEditing ? (
                  <div className={styles.editBlock}>
                    <textarea
                      className={`input ${styles.textarea}`}
                      value={editingContent}
                      maxLength={300}
                      rows={2}
                      onChange={(event) =>
                        setEditingContent(event.target.value)
                      }
                    />
                    <div className={styles.editActions}>
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="button"
                        disabled={updateMutation.isPending}
                        onClick={() =>
                          updateMutation.mutate({
                            id: comment.id,
                            content: editingContent,
                          })
                        }
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className={styles.commentContent}>{comment.content}</p>
                )}

                {isAuthor && !isEditing && (
                  <div className={styles.commentActions}>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => {
                        setEditingId(comment.id);
                        setEditingContent(comment.content);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles.linkButton}
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (
                          window.confirm('Delete this comment?')
                        ) {
                          deleteMutation.mutate(comment.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
