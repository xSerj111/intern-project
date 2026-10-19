'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { PostStatus, type IPostResponse } from '@repo/contracts';

import {
  archivePost,
  deletePost,
  postKeys,
  updatePost,
} from '../../lib/api/posts';
import { profileKeys } from '../../lib/api/profile';
import { useAuth } from '../../lib/auth/auth-context';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Menu, type MenuEntry } from '../ui/menu';
import { Textarea } from '../ui/input';

import styles from './post-menu.module.css';

export const POST_MAX_LENGTH = 500;

type Panel = 'edit' | 'archive' | 'delete' | null;

interface PostMenuProps {
  post: IPostResponse;
  /** Called after the post was deleted (e.g. to leave the detail page). */
  onDeleted?: () => void;
}

/** "…" menu for the post's author: edit text, archive, delete (with confirmation). */
export function PostMenu({ post, onDeleted }: PostMenuProps) {
  const { user, getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [draft, setDraft] = useState(post.content);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: postKeys.all });
    if (user?.id) {
      void queryClient.invalidateQueries({
        queryKey: profileKeys.summary(user.id),
      });
    }
  };

  const edit = useMutation({
    mutationFn: (content: string) =>
      updatePost(post.id, { content }, { token: getAccessToken() }),
    onSuccess: () => {
      refresh();
      setPanel(null);
    },
  });
  const archive = useMutation({
    mutationFn: () => archivePost(post.id, { token: getAccessToken() }),
    onSuccess: () => {
      refresh();
      setPanel(null);
    },
  });
  const remove = useMutation({
    mutationFn: () => deletePost(post.id, { token: getAccessToken() }),
    onSuccess: () => {
      refresh();
      setPanel(null);
      onDeleted?.();
    },
  });

  if (!user || user.id !== post.authorId) return null;

  const open = (next: Exclude<Panel, null>) => {
    edit.reset();
    archive.reset();
    remove.reset();
    if (next === 'edit') setDraft(post.content);
    setPanel(next);
  };

  const entries: MenuEntry[] = [
    { label: 'Edit', icon: Pencil, onSelect: () => open('edit') },
    ...(post.status === PostStatus.Published
      ? [
          {
            label: 'Archive',
            icon: Archive,
            onSelect: () => open('archive'),
          } satisfies MenuEntry,
        ]
      : []),
    { type: 'separator' },
    { label: 'Delete', icon: Trash2, danger: true, onSelect: () => open('delete') },
  ];

  const trimmed = draft.trim();
  const canSave =
    trimmed.length > 0 && trimmed !== post.content.trim() && !edit.isPending;

  function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (canSave) edit.mutate(trimmed);
  }

  return (
    <>
      <Menu
        label="Post options"
        trigger={<Ellipsis size={20} />}
        entries={entries}
      />

      <Dialog
        open={panel === 'edit'}
        onClose={() => !edit.isPending && setPanel(null)}
        title="Edit post"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPanel(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={`edit-post-${post.id}`}
              loading={edit.isPending}
              disabled={!canSave}
            >
              Save
            </Button>
          </>
        }
      >
        <form id={`edit-post-${post.id}`} onSubmit={submitEdit}>
          <Textarea
            aria-label="Post text"
            rows={5}
            value={draft}
            maxLength={POST_MAX_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            hint={`${draft.length}/${POST_MAX_LENGTH}`}
            error={edit.isError ? "Couldn't save your changes." : undefined}
          />
        </form>
      </Dialog>

      <Dialog
        open={panel === 'archive'}
        onClose={() => !archive.isPending && setPanel(null)}
        title="Archive this post?"
        flush={!archive.isError}
        description="It will no longer appear in feeds or on your profile. You can't undo this here."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPanel(null)}>
              Cancel
            </Button>
            <Button loading={archive.isPending} onClick={() => archive.mutate()}>
              Archive
            </Button>
          </>
        }
      >
        {archive.isError && (
          <p className={styles.error} role="alert">
            Couldn&apos;t archive the post. Try again.
          </p>
        )}
      </Dialog>

      <Dialog
        open={panel === 'delete'}
        onClose={() => !remove.isPending && setPanel(null)}
        title="Delete this post?"
        flush={!remove.isError}
        description="This permanently removes the post along with its comments and likes."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPanel(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Delete
            </Button>
          </>
        }
      >
        {remove.isError && (
          <p className={styles.error} role="alert">
            Couldn&apos;t delete the post. Try again.
          </p>
        )}
      </Dialog>
    </>
  );
}
