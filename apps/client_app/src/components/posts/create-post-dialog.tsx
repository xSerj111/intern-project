'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, ImagePlus, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';

import { uploadFile } from '../../lib/api/uploads';
import { createPost, postKeys, publishPost } from '../../lib/api/posts';
import { getMyProfile, profileKeys } from '../../lib/api/profile';
import { useAuth } from '../../lib/auth/auth-context';
import { cx } from '../../lib/cx';
import { Avatar } from '../ui/avatar';
import { Button, IconButton } from '../ui/button';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { Dialog } from '../ui/dialog';
import { MentionInput } from '../mentions/mention-input';
import { Spinner } from '../ui/spinner';

import styles from './create-post-dialog.module.css';
import { POST_MAX_LENGTH } from './post-menu';

const MAX_IMAGES = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif';

export interface CreatePostDialogProps {
  open: boolean;
  onClose: () => void;
}

interface Attachment {
  id: string;
  previewUrl: string;
  status: 'uploading' | 'done' | 'error';
  assetId?: string;
  error?: string;
}

let nextAttachmentId = 0;

/**
 * Post composer opened from the shell's "Create" button. The inner form is
 * mounted only while open, so every opening starts from a clean state.
 */
export function CreatePostDialog({ open, onClose }: CreatePostDialogProps) {
  return open ? <Composer onClose={onClose} /> : null;
}

function Composer({ onClose }: { onClose: () => void }) {
  const { accessToken, getAccessToken, user } = useAuth();
  const queryClient = useQueryClient();
  const formId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const aborters = useRef(new Map<string, AbortController>());
  const previews = useRef(new Set<string>());
  /** A draft created by a previous attempt whose publish step failed. */
  const draftId = useRef<string | null>(null);

  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Same cache entry the app shell uses for the sidebar profile link.
  const profile = useQuery({
    queryKey: profileKeys.me(user?.id),
    queryFn: ({ signal }) => getMyProfile(accessToken, signal),
    enabled: Boolean(accessToken),
  });
  const profileName =
    profile.data?.displayName || profile.data?.username || 'You';

  // The dialog is shown by its own effect (which runs first); then focus the text.
  useEffect(() => {
    textarea.current?.focus();
  }, []);

  // Abort uploads and release previews when the composer closes.
  useEffect(() => {
    const controllers = aborters.current;
    const urls = previews.current;
    return () => {
      controllers.forEach((controller) => controller.abort());
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const patch = useCallback((id: string, next: Partial<Attachment>) => {
    setAttachments((items) =>
      items.map((item) => (item.id === id ? { ...item, ...next } : item)),
    );
  }, []);

  const startUpload = useCallback(
    (id: string, file: File) => {
      const controller = new AbortController();
      aborters.current.set(id, controller);
      uploadFile(file, 'post-image', {
        token: getAccessToken(),
        signal: controller.signal,
      })
        .then((asset) => patch(id, { status: 'done', assetId: asset.id }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          patch(id, {
            status: 'error',
            error:
              error instanceof Error ? error.message : 'Upload failed',
          });
        })
        .finally(() => aborters.current.delete(id));
    },
    [getAccessToken, patch],
  );

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (picked.length === 0) return;

    setNotice(null);
    const room = MAX_IMAGES - attachments.length;
    const accepted: Attachment[] = [];
    const problems: string[] = [];

    for (const file of picked) {
      if (accepted.length >= room) {
        problems.push(`You can attach up to ${MAX_IMAGES} photos.`);
        break;
      }
      if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
        problems.push(`${file.name} is not a supported image.`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        problems.push(`${file.name} is larger than 10 MB.`);
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      previews.current.add(previewUrl);
      const id = `attachment-${nextAttachmentId++}`;
      accepted.push({ id, previewUrl, status: 'uploading' });
      startUpload(id, file);
    }

    if (accepted.length > 0) {
      setAttachments((items) => [...items, ...accepted]);
    }
    if (problems.length > 0) setNotice(problems[0]);
  }

  function removeAttachment(item: Attachment) {
    aborters.current.get(item.id)?.abort();
    aborters.current.delete(item.id);
    URL.revokeObjectURL(item.previewUrl);
    previews.current.delete(item.previewUrl);
    setAttachments((items) => items.filter((entry) => entry.id !== item.id));
  }

  const uploading = attachments.some((item) => item.status === 'uploading');
  const failed = attachments.some((item) => item.status === 'error');
  const assetIds = attachments.flatMap((item) =>
    item.assetId ? [item.assetId] : [],
  );
  const text = content.trim();

  const submit = useMutation({
    mutationFn: async () => {
      const token = getAccessToken();
      if (!draftId.current) {
        const created = await createPost(
          { content: text, assetIds: assetIds.length ? assetIds : undefined },
          { token },
        );
        draftId.current = created.id;
      }
      return publishPost(draftId.current, { token: getAccessToken() });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: postKeys.all });
      if (user?.id) {
        void queryClient.invalidateQueries({
          queryKey: profileKeys.summary(user.id),
        });
      }
      onClose();
    },
  });

  const canSubmit =
    text.length > 0 && !uploading && !failed && !submit.isPending;
  const dirty = content.length > 0 || attachments.length > 0;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (canSubmit) submit.mutate();
  }

  function requestClose() {
    if (submit.isPending) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  const submitError = submit.isError
    ? draftId.current
      ? "Your post was saved but couldn't be published. Try again."
      : "Couldn't create your post. Try again."
    : null;

  return (
    <>
      <Dialog
        open
        onClose={requestClose}
        title="Create new post"
        size="md"
        footer={
          <>
            <span className={styles.counter} aria-live="polite">
              {attachments.length}/{MAX_IMAGES} photos
            </span>
            <Button
              type="submit"
              form={formId}
              loading={submit.isPending}
              disabled={!canSubmit}
            >
              {submit.isError && draftId.current ? 'Retry publish' : 'Share'}
            </Button>
          </>
        }
      >
        <form id={formId} className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.author}>
            <Avatar
              src={profile.data?.avatarUrl}
              name={profileName}
              size="sm"
              decorative
            />
            <span className={styles.authorName}>{profileName}</span>
          </div>

          <MentionInput
            multiline
            block
            aria-label="Post text"
            placeholder="What's on your mind?"
            rows={4}
            maxLength={POST_MAX_LENGTH}
            value={content}
            onValueChange={setContent}
            disabled={submit.isPending}
            hint={`${content.length}/${POST_MAX_LENGTH}`}
            fieldRef={textarea}
          />

          {attachments.length > 0 && (
            <ul className={styles.grid} aria-label="Attached photos">
              {attachments.map((item, index) => (
                <li
                  key={item.id}
                  className={cx(
                    styles.thumb,
                    item.status === 'error' && styles.thumbError,
                  )}
                >
                  <img
                    src={item.previewUrl}
                    alt={`Attached photo ${index + 1}`}
                    className={styles.thumbImage}
                  />
                  {item.status === 'uploading' && (
                    <span className={styles.overlay}>
                      <Spinner size={22} label="Uploading photo" />
                    </span>
                  )}
                  {item.status === 'error' && (
                    <span
                      className={styles.overlay}
                      role="img"
                      aria-label={item.error ?? 'Upload failed'}
                      title={item.error ?? 'Upload failed'}
                    >
                      <CircleAlert size={22} />
                    </span>
                  )}
                  <IconButton
                    label={`Remove photo ${index + 1}`}
                    size="sm"
                    className={styles.remove}
                    disabled={submit.isPending}
                    onClick={() => removeAttachment(item)}
                  >
                    <X size={16} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}

          <div className={styles.tools}>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              onChange={addFiles}
            />
            <Button
              variant="secondary"
              size="sm"
              icon={<ImagePlus size={18} />}
              disabled={attachments.length >= MAX_IMAGES || submit.isPending}
              onClick={() => fileInput.current?.click()}
            >
              Add photos
            </Button>
            {failed && (
              <span className={styles.problem}>
                Remove the photos that failed to upload to continue.
              </span>
            )}
          </div>

          {(notice || submitError) && (
            <p className={styles.problem} role="alert">
              {submitError ?? notice}
            </p>
          )}
        </form>
      </Dialog>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this post?"
        description="Your text and photos won't be saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={onClose}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  );
}
