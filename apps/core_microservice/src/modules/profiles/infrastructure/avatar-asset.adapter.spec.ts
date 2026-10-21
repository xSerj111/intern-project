import { AssetNotAttachableError } from '../../assets/domain/errors/asset.errors';
import { AvatarAssetAdapter } from './avatar-asset.adapter';

describe('AvatarAssetAdapter', () => {
  const assets = { findByIds: jest.fn() };
  const adapter = new AvatarAssetAdapter(assets as never);
  const asset = (over: Record<string, unknown> = {}) => ({
    id: 'a-1',
    uploaderId: 'u-1',
    visibility: 'PUBLIC',
    url: 'https://cdn/a-1',
    mimeType: 'image/png',
    assertAttachableTo: jest.fn(),
    ...over,
  });

  beforeEach(() => jest.clearAllMocks());

  it('returns null for a missing or unconfirmed asset', async () => {
    assets.findByIds.mockResolvedValue([]);
    await expect(adapter.findAvatarSource('a-1')).resolves.toBeNull();
  });

  it('requires the avatar target and maps the source', async () => {
    const row = asset();
    assets.findByIds.mockResolvedValue([row]);

    await expect(adapter.findAvatarSource('a-1')).resolves.toEqual({
      id: 'a-1',
      uploaderId: 'u-1',
      url: 'https://cdn/a-1',
      mimeType: 'image/png',
    });
    expect(row.assertAttachableTo).toHaveBeenCalledWith('avatar', 'u-1');
  });

  it('propagates the asset rule for a non-avatar purpose', async () => {
    assets.findByIds.mockResolvedValue([
      asset({
        assertAttachableTo: jest.fn(() => {
          throw new AssetNotAttachableError('avatar');
        }),
      }),
    ]);
    await expect(adapter.findAvatarSource('a-1')).rejects.toBeInstanceOf(
      AssetNotAttachableError,
    );
  });
});
