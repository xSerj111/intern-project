import type { UploadPurpose } from '@repo/contracts';

export const CONTENT_SNIFFER = Symbol.for('IContentSniffer');

export interface ContentSniffResult {
  allowed: boolean;
  /** Type identified from the bytes (or the declared one for text types). */
  detectedMime?: string;
}

export interface IContentSniffer {
  /**
   * Checks the leading bytes of an uploaded object against the allowlist of
   * `purpose`. The declared type is never trusted for binary formats.
   *
   * @param head First bytes of the object (or all of it when small)
   * @param declaredMime Content type the client declared
   * @param purpose Upload purpose that selects the allowlist
   */
  detect(
    head: Buffer,
    declaredMime: string,
    purpose: UploadPurpose,
  ): Promise<ContentSniffResult>;
}
