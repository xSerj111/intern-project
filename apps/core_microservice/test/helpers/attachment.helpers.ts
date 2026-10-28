import type {
  IAssetResponse,
  IUploadTicket,
  IUploadedAttachment,
  UploadPurpose,
} from '@repo/contracts';
import type request from 'supertest';
import { bearer } from './api.helpers';
import type { Session } from './realtime.helpers';

/** Small in-memory files for the attachment e2e specs (magic numbers are real). */

/** A valid 1x1 transparent PNG. */
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** A minimal one-page PDF (header, body and trailer are enough for detection). */
export const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);

export const TXT_BYTES = Buffer.from('hello attachments\n', 'utf8');

/** A DOS/PE stub: starts with `MZ`, which file-type reports as application/x-msdownload. */
export const EXE_BYTES = Buffer.concat([
  Buffer.from('MZ', 'latin1'),
  Buffer.alloc(62, 0),
  Buffer.from('This program cannot be run in DOS mode.', 'latin1'),
]);

/** Distinct bytes per call, so downloads can be matched to the right upload. */
export const uniqueBytes = (base: Buffer, tag: string): Buffer =>
  Buffer.concat([base, Buffer.from(`\n<!-- ${tag} -->`, 'utf8')]);

/** Body of `POST /uploads` (`ICreateUploadRequest`). */
export interface UploadTicketRequest {
  purpose: UploadPurpose;
  contentType: string;
  size: number;
  fileName?: string;
}

/** `POST /uploads` → 201 ticket, for `session`. */
export async function requestUploadTicket(
  http: ReturnType<typeof request>,
  session: Pick<Session, 'accessToken'>,
  body: UploadTicketRequest,
): Promise<IUploadTicket> {
  const res = await http.post('/uploads').set(bearer(session)).send(body);
  if (res.status !== 201) {
    throw new Error(
      `POST /uploads answered ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return res.body as IUploadTicket;
}

/**
 * Multipart POST straight to object storage, as the browser does: every
 * signed field first, then `file`. `fields` overrides individual fields
 * (e.g. a different `key`) to probe the policy.
 */
export async function postToStorage(
  ticket: Pick<IUploadTicket, 'url' | 'fields'>,
  bytes: Buffer,
  fields: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const form = new FormData();
  for (const [name, value] of Object.entries({ ...ticket.fields, ...fields })) {
    form.append(name, value);
  }
  form.append(
    'file',
    new Blob([new Uint8Array(bytes)], {
      type: ticket.fields['Content-Type'] ?? 'application/octet-stream',
    }),
    'upload',
  );
  const res = await fetch(ticket.url, { method: 'POST', body: form });
  return { status: res.status, body: await res.text() };
}

/** Confirm body per purpose. */
export type ConfirmedBody<P extends UploadPurpose> = P extends 'chat-attachment'
  ? IUploadedAttachment
  : IAssetResponse;

/**
 * The full direct-upload flow: sign (`POST /uploads`) → multipart POST to
 * storage → `POST /uploads/:uploadId/confirm`. Returns the confirm body
 * (`IAssetResponse` for public purposes, `IUploadedAttachment` for chat).
 */
export async function presignedUpload<P extends UploadPurpose>(
  http: ReturnType<typeof request>,
  session: Pick<Session, 'accessToken'>,
  purpose: P,
  bytes: Buffer,
  mime: string,
  fileName?: string,
): Promise<ConfirmedBody<P>> {
  const ticket = await requestUploadTicket(http, session, {
    purpose,
    contentType: mime,
    size: bytes.length,
    ...(fileName === undefined ? {} : { fileName }),
  });
  const stored = await postToStorage(ticket, bytes);
  if (stored.status < 200 || stored.status >= 300) {
    throw new Error(`storage answered ${stored.status}: ${stored.body}`);
  }
  const res = await http
    .post(`/uploads/${ticket.uploadId}/confirm`)
    .set(bearer(session));
  if (res.status !== 200) {
    throw new Error(
      `confirm answered ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return res.body as ConfirmedBody<P>;
}
