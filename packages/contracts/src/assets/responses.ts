/** An uploaded media asset as returned by `POST /assets/upload`. */
export interface IAssetResponse {
  id: string;
  /** Public S3/MinIO URL. */
  url: string;
  mimeType: string;
  size: number;
  createdAt: string;
}
