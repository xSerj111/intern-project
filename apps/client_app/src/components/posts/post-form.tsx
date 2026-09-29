'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { PostStatus, type IPostResponse } from '@repo/contracts';

import {
  useCreatePost,
  usePublishPost,
  useUpdatePost,
} from '../../lib/hooks/use-post-mutations';

import { MediaUploader, type MediaItem } from './media-uploader';

import styles from './post-form.module.css';

const MAX_MEDIA = 10;
const MAX_CONTENT = 500;

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
  const createMutation = useCreatePost();
  const updateMutation = useUpdatePost(initialPost?.id ?? '');
  const publishMutation = usePublishPost(initialPost?.id ?? '');

  const [content, setContent] = useState(initialPost?.content ?? '');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isEdit = Boolean(initialPost);
  const isDraft = initialPost?.status === PostStatus.Draft;
  const isEmpty = content.trim().length === 0 && media.length === 0;

  async function submit(publish: boolean) {
    setError(null);
    setIsSaving(true);
    try {
      const assetIds = media.map((item) => item.assetId);
      let saved: IPostResponse;
      if (initialPost) {
        saved = await updateMutation.mutateAsync({ content, assetIds });
        if (publish && isDraft) {
          saved = await publishMutation.mutateAsync();
        }
      } else {
        saved = await createMutation.mutateAsync({
          content,
          assetIds,
          publish,
        });
      }

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

  const initialItems: MediaItem[] =
    initialPost?.assets.map((asset) => ({
      assetId: asset.assetId,
      url: asset.url,
      mediaType: asset.mediaType,
      name: asset.assetId,
    })) ?? [];

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

      <MediaUploader
        initialItems={initialItems}
        max={MAX_MEDIA}
        onChange={(items, busy) => {
          setMedia(items);
          setIsUploading(busy);
        }}
      />

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.actions}>
        {(!isEdit || isDraft) && (
          <button
            type="button"
            className="button button--ghost"
            disabled={isSaving || isUploading}
            onClick={() => void submit(false)}
          >
            Save draft
          </button>
        )}
        <button
          type="submit"
          className="button"
          disabled={
            isSaving || isUploading || ((!isEdit || isDraft) && isEmpty)
          }
        >
          {isEdit && !isDraft ? 'Save changes' : 'Publish'}
        </button>
      </div>
    </form>
  );
}
