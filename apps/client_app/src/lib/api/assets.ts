import type { IAssetResponse } from '@repo/contracts';

import { uploadCoreFile, type UploadOptions } from './client';

/**
 * Upload a public asset (`POST /assets/upload`, multipart field `file`, max
 * 10 MB) for use in posts or as an avatar. Pass `onProgress` for a 0..1 fraction.
 */
export function uploadAsset(
  file: File,
  options: UploadOptions = {},
): Promise<IAssetResponse> {
  return uploadCoreFile<IAssetResponse>('/assets/upload', file, options);
}
