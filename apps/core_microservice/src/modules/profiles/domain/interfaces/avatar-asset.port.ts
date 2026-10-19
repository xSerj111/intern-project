/** The facts about an uploaded asset that decide whether it can be an avatar. */
export interface AvatarSource {
  id: string;
  /** Auth user id of the uploader. */
  uploaderId: string;
  /** Public URL; `null` for private assets. */
  url: string | null;
  mimeType: string;
}

/**
 * Read-only asset lookup for profiles (bound to the assets module), so the
 * profile never touches asset tables or entities.
 */
export interface IAvatarAssetPort {
  /** `null` when the asset does not exist (or was deleted). */
  findAvatarSource(assetId: string): Promise<AvatarSource | null>;
}

export const AVATAR_ASSET_PORT = Symbol.for('IAvatarAssetPort');
