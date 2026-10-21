import { ATTACHMENT_MAX_BYTES } from '../chats/constants';
import type { UploadPurpose } from './requests';

/** Largest single upload, in bytes (10 MiB). */
export const UPLOAD_MAX_BYTES = ATTACHMENT_MAX_BYTES;

/** Lifetime of a presigned upload link. */
export const UPLOAD_LINK_TTL_SECONDS = 300;

const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

/** Allowed declared content types per upload purpose. */
export const UPLOAD_ALLOWLIST: Readonly<
  Record<UploadPurpose, readonly string[]>
> = {
  'post-image': IMAGE_MIME_TYPES,
  avatar: IMAGE_MIME_TYPES,
  // Same set as core's ATTACHMENT_MIME_TYPES pattern (chats/attachments.controller.ts).
  'chat-attachment': [
    ...IMAGE_MIME_TYPES,
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
};
