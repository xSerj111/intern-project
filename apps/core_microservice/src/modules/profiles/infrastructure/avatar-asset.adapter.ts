import { Injectable } from '@nestjs/common';

import { AssetsService } from '../../assets/assets.service';
import type {
  AvatarSource,
  IAvatarAssetPort,
} from '../domain/interfaces/avatar-asset.port';

/**
 * Resolves avatar candidates through the exported assets service.
 * @throws AssetNotAttachableError (400) when the asset's purpose doesn't fit
 */
@Injectable()
export class AvatarAssetAdapter implements IAvatarAssetPort {
  constructor(private readonly assets: AssetsService) {}

  async findAvatarSource(assetId: string): Promise<AvatarSource | null> {
    const [asset] = await this.assets.findByIds([assetId]);
    if (!asset) return null;
    // Ownership stays with the profile entity, so only the asset's own state
    // and purpose are checked here.
    asset.assertAttachableTo('avatar', asset.uploaderId);
    return {
      id: asset.id,
      uploaderId: asset.uploaderId,
      url: asset.visibility === 'PUBLIC' ? asset.url : null,
      mimeType: asset.mimeType,
    };
  }
}
