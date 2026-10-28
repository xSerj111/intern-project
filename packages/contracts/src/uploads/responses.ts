export interface IUploadTicket {
  /** Equals the asset id. */
  uploadId: string;
  /** Storage POST endpoint. */
  url: string;
  /** Send verbatim in the multipart form, before the file. */
  fields: Record<string, string>;
  maxBytes: number;
  /** ISO timestamp. */
  expiresAt: string;
}
