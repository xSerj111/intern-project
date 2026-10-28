'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import type { IProfileResponse } from '@repo/contracts';

import { uploadFile } from '../../lib/api/uploads';
import { postKeys } from '../../lib/api/posts';
import { profileKeys, updateProfile } from '../../lib/api/profile';
import { useAuth } from '../../lib/auth/auth-context';
import { Avatar } from '../ui/avatar';
import { Button } from '../ui/button';
import { Input, Textarea } from '../ui/input';
import { Spinner } from '../ui/spinner';

import styles from './edit-profile-form.module.css';

export const DISPLAY_NAME_MAX = 100;
export const BIO_MAX = 160;
const AVATAR_MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

interface EditProfileFormProps {
  profile: IProfileResponse;
  /** Called after a successful save. */
  onSaved?: () => void;
  /** Shows a Cancel button (dialog usage). */
  onCancel?: () => void;
}

/** Why a picked file can't be an avatar, or `null` when it is fine. */
function avatarFileProblem(file: File): string | null {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return 'Choose a PNG, JPEG, WebP or GIF image.';
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return 'The image must be 10 MB or smaller.';
  }
  return null;
}

/**
 * Avatar, display name and bio editor, shared by the edit dialog and the
 * settings page. Sends only the fields that changed.
 */
export function EditProfileForm({
  profile,
  onSaved,
  onCancel,
}: EditProfileFormProps) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio ?? '');
  /** `undefined`: unchanged, `null`: removed, string: newly uploaded asset. */
  const [avatarAssetId, setAvatarAssetId] = useState<string | null | undefined>(
    undefined,
  );
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    profile.avatarUrl,
  );
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const objectUrl = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  const upload = useMutation({
    mutationFn: (file: File) => uploadFile(file, 'avatar', { token: accessToken }),
    onSuccess: (asset) => setAvatarAssetId(asset.id),
    onError: (error) => {
      setAvatarError(
        error instanceof Error ? error.message : 'We couldn’t upload that image.',
      );
      // Fall back to the saved avatar.
      setAvatarPreview(profile.avatarUrl);
      setAvatarAssetId(undefined);
    },
  });

  const save = useMutation({
    mutationFn: () => {
      const trimmedName = displayName.trim();
      const trimmedBio = bio.trim();
      return updateProfile(
        profile.id,
        {
          ...(trimmedName !== profile.displayName && {
            displayName: trimmedName,
          }),
          ...(trimmedBio !== (profile.bio ?? '') && {
            bio: trimmedBio || null,
          }),
          ...(avatarAssetId !== undefined && { avatarAssetId }),
        },
        accessToken,
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: profileKeys.all }),
        queryClient.invalidateQueries({ queryKey: postKeys.all }),
      ]);
      // The avatar ids are consumed; the refreshed profile is the baseline.
      setAvatarAssetId(undefined);
      onSaved?.();
    },
  });

  function pickFile(file: File | undefined) {
    if (!file) return;
    const problem = avatarFileProblem(file);
    if (problem) {
      setAvatarError(problem);
      return;
    }
    setAvatarError(null);
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setAvatarPreview(objectUrl.current);
    upload.mutate(file);
  }

  function removeAvatar() {
    setAvatarError(null);
    setAvatarPreview(null);
    setAvatarAssetId(null);
  }

  const trimmedName = displayName.trim();
  const nameError =
    trimmedName.length === 0 ? 'Display name is required.' : undefined;
  const dirty =
    trimmedName !== profile.displayName ||
    bio.trim() !== (profile.bio ?? '') ||
    avatarAssetId !== undefined;
  const canSave =
    dirty && !nameError && !upload.isPending && !save.isPending;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (canSave) save.mutate();
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <div className={styles.avatarRow}>
        <div className={styles.avatarWrap}>
          <Avatar
            src={avatarPreview}
            name={profile.displayName}
            size="xl"
            ring
          />
          {upload.isPending && (
            <span className={styles.uploading}>
              <Spinner size={24} label="Uploading photo" />
            </span>
          )}
        </div>
        <div className={styles.avatarActions}>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            className="visually-hidden"
            tabIndex={-1}
            aria-label="Profile photo file"
            onChange={(event) => {
              pickFile(event.target.files?.[0]);
              // Allow picking the same file again after removing it.
              event.target.value = '';
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            icon={<Camera size={16} aria-hidden="true" />}
            disabled={upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            Change photo
          </Button>
          {avatarPreview && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={16} aria-hidden="true" />}
              disabled={upload.isPending}
              onClick={removeAvatar}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      {avatarError && (
        <p className={styles.error} role="alert">
          {avatarError}
        </p>
      )}

      <Input
        label="Display name"
        value={displayName}
        maxLength={DISPLAY_NAME_MAX}
        autoComplete="name"
        error={nameError}
        onChange={(event) => setDisplayName(event.target.value)}
      />

      <Textarea
        label="Bio"
        value={bio}
        rows={4}
        maxLength={BIO_MAX}
        placeholder="Tell people a little about yourself"
        hint={
          <span className={styles.counter}>
            {bio.length}/{BIO_MAX}
          </span>
        }
        onChange={(event) => setBio(event.target.value)}
      />

      {save.isError && (
        <p className={styles.error} role="alert">
          {save.error instanceof Error
            ? save.error.message
            : 'We couldn’t save your profile. Please try again.'}
        </p>
      )}

      <div className={styles.actions}>
        {save.isSuccess && !dirty && (
          <span className={styles.saved} role="status">
            Saved
          </span>
        )}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={save.isPending} disabled={!canSave}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
