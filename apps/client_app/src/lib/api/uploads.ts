import {
  UPLOAD_MAX_BYTES,
  type IAssetResponse,
  type ICreateUploadRequest,
  type IUploadedAttachment,
  type IUploadTicket,
  type UploadPurpose,
} from '@repo/contracts';

import { ApiError, coreApi, type UploadOptions } from './client';

const TOO_LARGE_MESSAGE = 'File is larger than 10 MB';
const FAILED_MESSAGE = 'Upload failed, please try again';

/** Confirmed upload: an asset for posts/avatars, an attachment for chats. */
export interface UploadResultByPurpose {
  'post-image': IAssetResponse;
  avatar: IAssetResponse;
  'chat-attachment': IUploadedAttachment;
}

/**
 * POST the file straight to object storage with the ticket's signed form:
 * every `fields` entry first, `file` last. No auth header, since the policy
 * authorizes the request. Rejects with an {@link ApiError} on non-2xx.
 */
function postToStorage(
  ticket: IUploadTicket,
  file: File,
  { signal, onProgress }: UploadOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [name, value] of Object.entries(ticket.fields)) {
      form.append(name, value);
    }
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', ticket.url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(event.loaded / event.total);
      }
    };
    xhr.onerror = () => reject(new ApiError(FAILED_MESSAGE, 0, null));
    xhr.onabort = () =>
      reject(new DOMException('The upload was aborted', 'AbortError'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      // Storage answers S3-style XML, e.g. `<Code>EntityTooLarge</Code>`.
      const tooLarge = (xhr.responseText ?? '').includes('EntityTooLarge');
      reject(
        new ApiError(
          tooLarge ? TOO_LARGE_MESSAGE : FAILED_MESSAGE,
          xhr.status,
          xhr.responseText,
        ),
      );
    };
    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('The upload was aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

/**
 * Direct-to-storage upload: `POST /uploads` (ticket) → multipart POST to
 * storage → `POST /uploads/:id/confirm`. Resolves with `IAssetResponse` for
 * `post-image`/`avatar` and `IUploadedAttachment` for `chat-attachment`.
 * Files over `UPLOAD_MAX_BYTES` are rejected before a ticket is requested, and
 * a failed storage POST never reaches confirm. `onProgress` gets a 0..1 fraction.
 */
export async function uploadFile<P extends UploadPurpose>(
  file: File,
  purpose: P,
  options: UploadOptions = {},
): Promise<UploadResultByPurpose[P]> {
  const { token, signal } = options;
  if (file.size > UPLOAD_MAX_BYTES) {
    throw new ApiError(TOO_LARGE_MESSAGE, 400, null);
  }

  const body: ICreateUploadRequest = {
    purpose,
    contentType: file.type,
    size: file.size,
    ...(file.name ? { fileName: file.name.slice(0, 255) } : {}),
  };
  const ticket = await coreApi<IUploadTicket>('/uploads', {
    method: 'POST',
    token,
    signal,
    body,
  });

  await postToStorage(ticket, file, options);

  return coreApi<UploadResultByPurpose[P]>(
    `/uploads/${encodeURIComponent(ticket.uploadId)}/confirm`,
    { method: 'POST', token, signal },
  );
}
