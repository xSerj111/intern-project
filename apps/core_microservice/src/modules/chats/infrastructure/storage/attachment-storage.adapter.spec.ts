import { signedUrlKey } from '../../../../common/cache/cache-keys';
import type { AssetsService } from '../../../assets/assets.service';
import {
  ATTACHMENT_URL_TTL_SECONDS,
  type PresignableAttachment,
} from '../../domain/interfaces/attachment-storage.port';
import { AttachmentStorageAdapter } from './attachment-storage.adapter';

const NOW = new Date('2026-01-01T12:00:00.000Z').getTime();
const TTL_MS = ATTACHMENT_URL_TTL_SECONDS * 1000;

const image: PresignableAttachment = {
  id: 'asset-1',
  storageKey: 'chat/u/asset-1',
  mimeType: 'image/png',
  originalName: 'a.png',
};
const doc: PresignableAttachment = {
  id: 'asset-2',
  storageKey: 'chat/u/asset-2',
  mimeType: 'application/pdf',
  originalName: 'b.pdf',
};

describe('AttachmentStorageAdapter signed-link cache', () => {
  const assets = { presignGet: jest.fn() };
  const cache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  let adapter: AttachmentStorageAdapter;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    assets.presignGet.mockResolvedValue('https://signed/new');
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue(undefined);
    cache.del.mockResolvedValue(undefined);
    adapter = new AttachmentStorageAdapter(
      assets as unknown as AssetsService,
      cache,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('signs on a miss and stores { url, expiresAt } for 450 s', async () => {
    const result = await adapter.presign(image);

    expect(result).toEqual({
      url: 'https://signed/new',
      expiresAt: new Date(NOW + TTL_MS),
    });
    expect(assets.presignGet).toHaveBeenCalledWith('chat/u/asset-1', {
      ttlSeconds: ATTACHMENT_URL_TTL_SECONDS,
      downloadName: undefined,
    });
    expect(cache.get).toHaveBeenCalledWith(signedUrlKey('asset-1', 'inline'));
    expect(cache.set).toHaveBeenCalledWith(
      signedUrlKey('asset-1', 'inline'),
      {
        url: 'https://signed/new',
        expiresAt: new Date(NOW + TTL_MS).toISOString(),
      },
      450,
    );
  });

  it('serves a cached link that still has at least half its validity', async () => {
    const expiresAt = new Date(NOW + TTL_MS / 2);
    cache.get.mockResolvedValue({
      url: 'https://signed/cached',
      expiresAt: expiresAt.toISOString(),
    });

    const result = await adapter.presign(image);

    expect(result).toEqual({ url: 'https://signed/cached', expiresAt });
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(assets.presignGet).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('re-signs when the cached link has less than half its validity left', async () => {
    cache.get.mockResolvedValue({
      url: 'https://signed/stale',
      expiresAt: new Date(NOW + TTL_MS / 2 - 1).toISOString(),
    });

    const result = await adapter.presign(image);

    expect(result.url).toBe('https://signed/new');
    expect(cache.set).toHaveBeenCalledTimes(1);
  });

  it('keys media and download links separately and names downloads', async () => {
    await adapter.presign(doc);

    expect(cache.get).toHaveBeenCalledWith(
      signedUrlKey('asset-2', 'attachment'),
    );
    expect(assets.presignGet).toHaveBeenCalledWith('chat/u/asset-2', {
      ttlSeconds: ATTACHMENT_URL_TTL_SECONDS,
      downloadName: 'b.pdf',
    });
  });

  it('invalidates both disposition variants of every asset', async () => {
    await adapter.invalidateSignedUrls(['asset-1', 'asset-2']);

    expect(cache.del).toHaveBeenCalledWith(
      signedUrlKey('asset-1', 'inline'),
      signedUrlKey('asset-1', 'attachment'),
      signedUrlKey('asset-2', 'inline'),
      signedUrlKey('asset-2', 'attachment'),
    );
  });

  it('does not touch the cache when there is nothing to invalidate', async () => {
    await adapter.invalidateSignedUrls([]);

    expect(cache.del).not.toHaveBeenCalled();
  });
});
