import type { IAssetResponse } from '@repo/contracts';

import { config } from '../config';
import { ApiError } from './client';

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Accepted upload MIME types (mirrors the backend whitelist, FR-006). */
export const ACCEPTED_UPLOAD_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
];

/** Human-readable client-side validation for a selected file. */
export function validateUploadFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `${file.name} is larger than 10 MB.`;
  }
  if (!ACCEPTED_UPLOAD_TYPES.includes(file.type)) {
    return `${file.name} must be an image or video.`;
  }
  return null;
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageFrom(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(', ');
  }
  return undefined;
}

/**
 * Upload a single image/video to `POST /assets/upload`, reporting progress as a
 * percentage (0–100). Uses XMLHttpRequest because `fetch` cannot report upload
 * progress (FR-005). Aborting `signal` cancels the request.
 */
export function uploadAsset(
  file: File,
  token: string | null,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<IAssetResponse> {
  return new Promise<IAssetResponse>((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${config.coreServiceUrl}/assets/upload`);
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      const payload = parseBody(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as IAssetResponse);
        return;
      }
      reject(
        new ApiError(
          messageFrom(payload) ?? `Upload failed with status ${xhr.status}`,
          xhr.status,
          payload,
        ),
      );
    };

    xhr.onerror = () => {
      reject(new ApiError('Unable to reach the service', 0, null));
    };

    xhr.onabort = () => {
      reject(new ApiError('Upload cancelled', 0, null));
    };

    if (signal?.aborted) {
      reject(new ApiError('Upload cancelled', 0, null));
      return;
    }
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    xhr.send(form);
  });
}
