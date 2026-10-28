/** An uploaded asset as returned by `POST /assets/upload`. */
export interface IAssetResponse {
  id: string;
  /** Public URL; `null` for private assets. */
  url: string | null;
  mimeType: string;
  /** Size in bytes. */
  size: number;
  createdAt: string;
}
