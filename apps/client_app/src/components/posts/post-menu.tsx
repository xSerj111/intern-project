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
import { ConfirmDialog } from '../ui/confirm-dialog';
import { Dialog } from '../ui/dialog';
import { MentionInput } from '../mentions/mention-input';
import { Menu, type MenuEntry } from '../ui/menu';

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
          <MentionInput
            multiline
            block
            aria-label="Post text"
            rows={5}
            value={draft}
            maxLength={POST_MAX_LENGTH}
            onValueChange={setDraft}
            hint={`${draft.length}/${POST_MAX_LENGTH}`}
            error={edit.isError ? "Couldn't save your changes." : undefined}
          />
        </form>
      </Dialog>

      <ConfirmDialog
        open={panel === 'archive'}
        title="Archive this post?"
        description="It will no longer appear in feeds or on your profile. You can't undo this here."
        confirmLabel="Archive"
        busy={archive.isPending}
        error={archive.isError ? "Couldn't archive the post. Try again." : null}
        onConfirm={() => archive.mutate()}
        onCancel={() => setPanel(null)}
      />

      <ConfirmDialog
        open={panel === 'delete'}
        title="Delete this post?"
        description="This permanently removes the post along with its comments and likes."
        confirmLabel="Delete"
        destructive
        busy={remove.isPending}
        error={remove.isError ? "Couldn't delete the post. Try again." : null}
        onConfirm={() => remove.mutate()}
        onCancel={() => setPanel(null)}
      />
    </>
  );
}
