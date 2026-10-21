import { Registry, type Counter } from 'prom-client';
import { EntityByIdNotFoundError } from '@repo/shared';
import { UPLOAD_MAX_BYTES, type UploadPurpose } from '@repo/contracts';
import { UPLOAD_SNIFF_BYTES, UploadsService } from './uploads.service';
import { Asset } from './domain/entities/asset.entity';
import {
  UploadContentRejectedError,
  UploadExpiredError,
  UploadNotReadyError,
  UploadObjectChangedError,
  UploadTooLargeError,
} from './domain/errors/asset.errors';

describe('UploadsService', () => {
  const PRIVATE = 'innogram-private';
  const PUBLIC = 'innogram-assets';

  const pending = (
    purpose: UploadPurpose = 'post-image',
    opts: { now?: Date; ttlSec?: number; uploaderId?: string } = {},
  ): Asset => {
    const asset = Asset.createPending({
      uploaderId: opts.uploaderId ?? 'user-1',
      purpose,
      declaredMime:
        purpose === 'chat-attachment' ? 'application/pdf' : 'image/jpeg',
      declaredSize: 1000,
      bucket: PRIVATE,
      fileName: purpose === 'chat-attachment' ? 'doc.pdf' : undefined,
      now: opts.now ?? new Date(),
      ttlSec: opts.ttlSec ?? 300,
    });
    asset.createdAt = new Date('2026-01-01T00:00:00Z');
    return asset;
  };

  const build = (asset: Asset | null = null) => {
    const repo = {
      findById: jest.fn().mockResolvedValue(asset),
      save: jest.fn((a: Asset) => {
        a.createdAt ??= new Date('2026-01-01T00:00:00Z');
        return Promise.resolve(a);
      }),
    };
    const storage = {
      presignPost: jest.fn().mockResolvedValue({
        url: 'http://s3/innogram-private',
        fields: { key: 'k', Policy: 'p' },
      }),
      head: jest.fn().mockResolvedValue({ size: 2048, etag: '"e1"' }),
      readHead: jest.fn().mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff])),
      copyToPublic: jest
        .fn()
        .mockImplementation((_b: string, _k: string, dest: string) =>
          Promise.resolve(`http://s3/${PUBLIC}/${dest}`),
        ),
      copyToPrivate: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    const sniffer = {
      detect: jest
        .fn()
        .mockResolvedValue({ allowed: true, detectedMime: 'image/png' }),
    };
    const config = {
      s3: { privateBucket: PRIVATE, bucketName: PUBLIC },
      uploads: { linkTtlSec: 300 },
    };
    const registry = new Registry();
    const logger = { info: jest.fn(), warn: jest.fn() };
    const service = new UploadsService(
      repo as never,
      storage as never,
      sniffer,
      config as never,
      registry,
      logger as never,
    );
    const metric = async (purpose: string, outcome: string) => {
      const counter = registry.getSingleMetric('uploads_total') as Counter;
      const { values } = await counter.get();
      return (
        values.find(
          (v) => v.labels.purpose === purpose && v.labels.outcome === outcome,
        )?.value ?? 0
      );
    };
    return { service, repo, storage, sniffer, logger, metric };
  };

  describe('createUpload', () => {
    it('saves a PENDING asset and returns a presigned ticket', async () => {
      const { service, repo, storage } = build();

      const ticket = await service.createUpload('user-1', {
        purpose: 'post-image',
        contentType: 'image/jpeg',
        size: 1000,
      });

      const saved = repo.save.mock.calls[0][0];
      expect(saved.status).toBe('PENDING');
      expect(saved.storageKey).toBe(`pending/user-1/${saved.id}`);
      expect(storage.presignPost).toHaveBeenCalledWith({
        bucket: PRIVATE,
        key: saved.storageKey,
        contentType: 'image/jpeg',
        maxBytes: UPLOAD_MAX_BYTES,
        expiresSec: 300,
      });
      expect(ticket).toEqual({
        uploadId: saved.id,
        url: 'http://s3/innogram-private',
        fields: { key: 'k', Policy: 'p' },
        maxBytes: UPLOAD_MAX_BYTES,
        expiresAt: saved.expiresAt?.toISOString(),
      });
    });

    it('does not presign when the domain rejects the request', async () => {
      const { service, repo, storage } = build();

      await expect(
        service.createUpload('user-1', {
          purpose: 'avatar',
          contentType: 'image/svg+xml',
          size: 10,
        }),
      ).rejects.toThrow();
      expect(repo.save).not.toHaveBeenCalled();
      expect(storage.presignPost).not.toHaveBeenCalled();
    });
  });

  describe('confirm', () => {
    it('returns 404 for an unknown upload', async () => {
      const { service, storage } = build(null);

      await expect(service.confirm('user-1', 'missing')).rejects.toThrow(
        EntityByIdNotFoundError,
      );
      expect(storage.head).not.toHaveBeenCalled();
    });

    it("returns 404 for someone else's upload, even when READY", async () => {
      const asset = pending('post-image', { uploaderId: 'owner' });
      const { service, storage } = build(asset);

      await expect(service.confirm('intruder', asset.id)).rejects.toThrow(
        EntityByIdNotFoundError,
      );

      asset.confirm({
        detectedMime: 'image/png',
        actualSize: 1,
        bucket: PUBLIC,
        key: 'k',
        url: 'u',
      });
      await expect(service.confirm('intruder', asset.id)).rejects.toThrow(
        EntityByIdNotFoundError,
      );
      expect(storage.head).not.toHaveBeenCalled();
    });

    it('throws UploadExpiredError without side effects and counts it', async () => {
      const asset = pending('avatar', {
        now: new Date(Date.now() - 3_600_000),
      });
      const { service, storage, repo, metric } = build(asset);

      await expect(service.confirm('user-1', asset.id)).rejects.toThrow(
        UploadExpiredError,
      );
      expect(storage.head).not.toHaveBeenCalled();
      expect(storage.deleteObject).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(await metric('avatar', 'expired')).toBe(1);
    });

    it('throws UploadNotReadyError when the object is missing', async () => {
      const asset = pending();
      const { service, storage, repo } = build(asset);
      storage.head.mockResolvedValue(null);

      await expect(service.confirm('user-1', asset.id)).rejects.toThrow(
        UploadNotReadyError,
      );
      expect(storage.readHead).not.toHaveBeenCalled();
      expect(storage.deleteObject).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(asset.status).toBe('PENDING');
    });

    it('deletes the object and soft-deletes the row when the stored size is too large', async () => {
      const asset = pending();
      const { service, storage, repo, metric } = build(asset);
      storage.head.mockResolvedValue({ size: UPLOAD_MAX_BYTES + 1 });

      await expect(service.confirm('user-1', asset.id)).rejects.toThrow(
        UploadTooLargeError,
      );
      expect(storage.readHead).not.toHaveBeenCalled();
      expect(storage.deleteObject).toHaveBeenCalledWith(
        PRIVATE,
        asset.storageKey,
      );
      expect(asset.deletedAt).toBeInstanceOf(Date);
      expect(repo.save).toHaveBeenCalledWith(asset);
      expect(await metric('post-image', 'rejected_size')).toBe(1);
    });

    it('deletes the object and soft-deletes the row when content is rejected', async () => {
      const asset = pending();
      const { service, storage, sniffer, repo, metric } = build(asset);
      sniffer.detect.mockResolvedValue({ allowed: false });

      const error = await service
        .confirm('user-1', asset.id)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UploadContentRejectedError);
      expect((error as Error).message).toBe(
        'File content is not an allowed type',
      );
      expect(storage.readHead).toHaveBeenCalledWith(
        PRIVATE,
        asset.storageKey,
        UPLOAD_SNIFF_BYTES,
        '"e1"',
      );
      expect(sniffer.detect).toHaveBeenCalledWith(
        expect.any(Buffer),
        'image/jpeg',
        'post-image',
      );
      expect(storage.deleteObject).toHaveBeenCalledWith(
        PRIVATE,
        asset.storageKey,
      );
      expect(storage.copyToPublic).not.toHaveBeenCalled();
      expect(asset.deletedAt).toBeInstanceOf(Date);
      expect(repo.save).toHaveBeenCalledWith(asset);
      expect(await metric('post-image', 'rejected_content')).toBe(1);
    });

    it('promotes a public upload with the detected extension, then deletes the pending object', async () => {
      const asset = pending('post-image');
      const pendingKey = asset.storageKey;
      const { service, storage, metric } = build(asset);

      const response = await service.confirm('user-1', asset.id);

      expect(storage.copyToPublic).toHaveBeenCalledWith(
        PRIVATE,
        pendingKey,
        `${asset.id}.png`,
        { contentType: 'image/png', ifMatch: '"e1"' },
      );
      expect(storage.deleteObject).toHaveBeenCalledWith(PRIVATE, pendingKey);
      expect(storage.copyToPublic.mock.invocationCallOrder[0]).toBeLessThan(
        storage.deleteObject.mock.invocationCallOrder[0],
      );
      expect(asset.status).toBe('READY');
      expect(asset.visibility).toBe('PUBLIC');
      expect(asset.bucket).toBe(PUBLIC);
      expect(asset.storageKey).toBe(`${asset.id}.png`);
      expect(response).toEqual({
        id: asset.id,
        url: `http://s3/${PUBLIC}/${asset.id}.png`,
        mimeType: 'image/png',
        size: 2048,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      expect(await metric('post-image', 'confirmed')).toBe(1);
    });

    it('moves a chat attachment off the reusable pending key, keeps it private and returns IUploadedAttachment', async () => {
      const asset = pending('chat-attachment');
      const pendingKey = asset.storageKey;
      const { service, storage, sniffer } = build(asset);
      sniffer.detect.mockResolvedValue({
        allowed: true,
        detectedMime: 'application/pdf',
      });

      const response = await service.confirm('user-1', asset.id);

      expect(storage.copyToPublic).not.toHaveBeenCalled();
      expect(storage.copyToPrivate).toHaveBeenCalledWith(
        PRIVATE,
        pendingKey,
        `chat/user-1/${asset.id}`,
        { contentType: 'application/pdf', ifMatch: '"e1"' },
      );
      expect(storage.deleteObject).toHaveBeenCalledWith(PRIVATE, pendingKey);
      expect(asset.bucket).toBe(PRIVATE);
      expect(asset.storageKey).toBe(`chat/user-1/${asset.id}`);
      expect(asset.visibility).toBe('PRIVATE');
      expect(response).toEqual({
        id: asset.id,
        mimeType: 'application/pdf',
        size: 2048,
        originalName: 'doc.pdf',
      });
    });

    it('is idempotent: a second confirm returns the same body without storage calls', async () => {
      const asset = pending('avatar');
      const { service, storage, repo, metric } = build(asset);

      const first = await service.confirm('user-1', asset.id);
      jest.clearAllMocks();
      const second = await service.confirm('user-1', asset.id);

      expect(second).toEqual(first);
      expect(storage.head).not.toHaveBeenCalled();
      expect(storage.copyToPublic).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(await metric('avatar', 'confirmed')).toBe(1);
    });

    it('deletes the promoted object and rethrows when the final save fails', async () => {
      const asset = pending('post-image');
      const { service, storage, repo, metric } = build(asset);
      repo.save.mockRejectedValue(new Error('db down'));

      await expect(service.confirm('user-1', asset.id)).rejects.toThrow(
        'db down',
      );
      expect(storage.deleteObject).toHaveBeenLastCalledWith(
        PUBLIC,
        `${asset.id}.png`,
      );
      expect(await metric('post-image', 'confirmed')).toBe(0);
    });

    it('still rethrows the save error when removing the promoted object fails', async () => {
      const asset = pending('post-image');
      const { service, storage, repo, logger } = build(asset);
      repo.save.mockRejectedValue(new Error('db down'));
      storage.deleteObject
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('s3 down'));

      await expect(service.confirm('user-1', asset.id)).rejects.toThrow(
        'db down',
      );
      expect(logger.warn).toHaveBeenCalled();
    });

    it('leaves the upload PENDING when the object is replaced mid-confirm', async () => {
      const asset = pending('chat-attachment');
      const { service, storage, repo } = build(asset);
      storage.copyToPrivate.mockRejectedValue(new UploadObjectChangedError());

      await expect(service.confirm('user-1', asset.id)).rejects.toBeInstanceOf(
        UploadObjectChangedError,
      );
      expect(storage.deleteObject).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(asset.status).toBe('PENDING');
    });
  });
});
