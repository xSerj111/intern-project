'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import type { IPostResponse, MediaKind } from '@repo/contracts';

import { uploadAsset, validateUploadFile } from '../../lib/api/assets';
import { useAuth } from '../../lib/auth/auth-context';
import {
  useCreatePost,
  useUpdatePost,
} from '../../lib/hooks/use-post-mutations';

import styles from './post-form.module.css';

const MAX_MEDIA = 10;
const MAX_CONTENT = 500;

interface MediaItem {
  assetId: string;
  url: string;
  mediaType: MediaKind;
  name: string;
}

export interface PostFormProps {
  /** When present, the form edits this post instead of creating a new one. */
  initialPost?: IPostResponse;
  /** Called after a successful save; defaults to redirecting to the feed. */
  onSuccess?: (post: IPostResponse) => void;
}

/**
 * Compose form: text (≤500), up to 10 image/video uploads with progress, and
 * Publish / Save-draft actions. Publish is blocked for empty posts (FR-007).
 */
export function PostForm({ initialPost, onSuccess }: PostFormProps) {
  const router = useRouter();
  const { accessToken } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const createMutation = useCreatePost();
  const updateMutation = useUpdatePost(initialPost?.id ?? '');

  const [content, setContent] = useState(initialPost?.content ?? '');
  const [media, setMedia] = useState<MediaItem[]>(
    initialPost?.assets.map((asset) => ({
      assetId: asset.assetId,
      url: asset.url,
      mediaType: asset.mediaType,
      name: asset.assetId,
    })) ?? [],
  );
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isEdit = Boolean(initialPost);
  const isEmpty = content.trim().length === 0 && media.length === 0;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    const remainingSlots = MAX_MEDIA - media.length;
    if (files.length > remainingSlots) {
      setError(`You can attach at most ${MAX_MEDIA} media items.`);
      return;
    }

    for (const file of Array.from(files)) {
      const validationError = validateUploadFile(file);
      if (validationError) {
        setError(validationError);
        continue;
      }

      try {
        setProgress(0);
        const asset = await uploadAsset(file, accessToken, setProgress);
        setMedia((current) => [
          ...current,
          {
            assetId: asset.id,
            url: asset.url,
            mediaType: asset.mimeType.startsWith('video/') ? 'video' : 'image',
            name: file.name,
          },
        ]);
      } catch (uploadError) {
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : 'Upload failed. Please try again.',
        );
      } finally {
        setProgress(null);
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function submit(publish: boolean) {
    setError(null);
    setIsSaving(true);
    try {
      const assetIds = media.map((item) => item.assetId);
      const saved = initialPost
        ? await updateMutation.mutateAsync({ content, assetIds })
        : await createMutation.mutateAsync({ content, assetIds, publish });

      if (onSuccess) {
        onSuccess(saved);
      } else {
        router.push('/');
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Could not save the post.',
      );
    } finally {
      setIsSaving(false);
    }
  }

  function removeMedia(assetId: string) {
    setMedia((current) => current.filter((item) => item.assetId !== assetId));
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void submit(true);
      }}
    >
      <label className={styles.field}>
        <span className={styles.label}>What&apos;s on your mind?</span>
        <textarea
          className={`input ${styles.textarea}`}
          value={content}
          maxLength={MAX_CONTENT}
          rows={4}
          placeholder="Share something…"
          onChange={(event) => setContent(event.target.value)}
        />
        <span className={`muted ${styles.counter}`}>
          {content.length}/{MAX_CONTENT}
        </span>
      </label>

      <div className={styles.mediaSection}>
        <div className={styles.mediaHeader}>
          <span className={styles.label}>Media</span>
          <span className="muted">
            {media.length}/{MAX_MEDIA}
          </span>
        </div>

        {media.length > 0 && (
          <ul className={styles.mediaList}>
            {media.map((item) => (
              <li key={item.assetId} className={styles.mediaItem}>
                {item.mediaType === 'video' ? (
                  <video
                    src={item.url}
                    className={styles.mediaThumb}
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <img
                    src={item.url}
                    alt={item.name}
                    className={styles.mediaThumb}
                  />
                )}
                <button
                  type="button"
                  className={styles.remove}
                  onClick={() => removeMedia(item.assetId)}
                  aria-label={`Remove ${item.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className={styles.fileInput}
          onChange={(event) => void handleFiles(event.target.files)}
        />

        {progress !== null && (
          <p className={`muted ${styles.progress}`} role="status">
            Uploading… {progress}%
          </p>
        )}
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className="button button--ghost"
          disabled={isSaving || progress !== null}
          onClick={() => void submit(false)}
        >
          Save draft
        </button>
        <button
          type="submit"
          className="button"
          disabled={isSaving || progress !== null || (!isEdit && isEmpty)}
        >
          {isEdit ? 'Save changes' : 'Publish'}
        </button>
      </div>
    </form>
  );
}
