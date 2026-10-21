import { EntityByIdNotFoundError } from '@repo/shared';
import { UPLOAD_MAX_BYTES, type UploadPurpose } from '@repo/contracts';
import { Asset, ASSET_ORIGINAL_NAME_MAX_LENGTH } from './asset.entity';
import {
  AssetNotAttachableError,
  MissingStorageKeyError,
  UploadExpiredError,
  UploadNotPendingError,
  UploadNotReadyError,
  UploadTooLargeError,
  UploadTypeNotAllowedError,
} from '../errors/asset.errors';

const privateProps = {
  uploaderId: 'user-1',
  bucket: 'innogram-private',
  storageKey: 'chat/user-1/abc',
  mimeType: 'application/pdf',
  size: 1024,
  originalName: 'report.pdf',
};

describe('Asset', () => {
  describe('create', () => {
    it('keeps public uploads PUBLIC with a url and no private fields', () => {
      const asset = Asset.create({
        uploaderId: 'user-1',
        url: 'http://localhost:9000/innogram-assets/a.png',
        mimeType: 'image/png',
        size: 10,
      });

      expect(asset.visibility).toBe('PUBLIC');
      expect(asset.url).toBe('http://localhost:9000/innogram-assets/a.png');
      expect(asset.storageKey ?? null).toBeNull();
    });
  });

  describe('createPrivate', () => {
    it('sets visibility PRIVATE and leaves url null', () => {
      const asset = Asset.createPrivate(privateProps);

      expect(asset.visibility).toBe('PRIVATE');
      expect(asset.url).toBeNull();
      expect(asset.bucket).toBe('innogram-private');
      expect(asset.storageKey).toBe('chat/user-1/abc');
      expect(asset.uploaderId).toBe('user-1');
      expect(asset.mimeType).toBe('application/pdf');
      expect(asset.size).toBe(1024);
    });

    it('requires a storage key', () => {
      expect(() =>
        Asset.createPrivate({ ...privateProps, storageKey: '' }),
      ).toThrow(MissingStorageKeyError);
      expect(() =>
        Asset.createPrivate({ ...privateProps, storageKey: '   ' }),
      ).toThrow(MissingStorageKeyError);
    });

    it('removes path parts from the original name', () => {
      expect(
        Asset.createPrivate({
          ...privateProps,
          originalName: '../../etc/passwd',
        }).originalName,
      ).toBe('passwd');
      expect(
        Asset.createPrivate({
          ...privateProps,
          originalName: 'C:\\Users\\me\\doc.pdf',
        }).originalName,
      ).toBe('doc.pdf');
    });

    it('removes control characters from the original name', () => {
      const asset = Asset.createPrivate({
        ...privateProps,
        originalName: 're\u0000po\r\nrt\u007f.pdf',
      });

      expect(asset.originalName).toBe('report.pdf');
    });

    it('caps the original name at 255 characters', () => {
      const asset = Asset.createPrivate({
        ...privateProps,
        originalName: 'a'.repeat(400),
      });

      expect(asset.originalName).toHaveLength(ASSET_ORIGINAL_NAME_MAX_LENGTH);
    });

    it('stores a null name when nothing usable remains', () => {
      const asset = Asset.createPrivate({
        ...privateProps,
        originalName: '/\u0000',
      });

      expect(asset.originalName).toBeNull();
    });
  });

  describe('softDelete', () => {
    it('marks the asset deleted', () => {
      const asset = Asset.createPrivate(privateProps);

      asset.softDelete();

      expect(asset.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe('upload lifecycle', () => {
    const NOW = new Date('2026-01-01T12:00:00.000Z');
    const TTL = 300;
    const pending = (
      overrides: Partial<Parameters<typeof Asset.createPending>[0]> = {},
    ) =>
      Asset.createPending({
        uploaderId: 'user-1',
        purpose: 'post-image',
        declaredMime: 'image/png',
        declaredSize: 1024,
        bucket: 'innogram-private',
        fileName: 'photo.png',
        now: NOW,
        ttlSec: TTL,
        ...overrides,
      });
    const at = (offsetSec: number) =>
      new Date(NOW.getTime() + offsetSec * 1000);
    const confirmProps = {
      detectedMime: 'image/jpeg',
      actualSize: 2048,
      bucket: 'innogram-assets',
      key: 'posts/user-1/x',
      url: 'http://localhost:9000/innogram-assets/posts/user-1/x',
    };
    const ready = (purpose: UploadPurpose | null, uploaderId = 'user-1') => {
      const asset = pending({
        purpose: purpose ?? 'chat-attachment',
        uploaderId,
      });
      asset.confirm(confirmProps);
      asset.purpose = purpose;
      return asset;
    };

    describe('createPending', () => {
      it('creates a PENDING private asset with an expiry', () => {
        const asset = pending();

        expect(asset.status).toBe('PENDING');
        expect(asset.visibility).toBe('PRIVATE');
        expect(asset.url).toBeNull();
        expect(asset.bucket).toBe('innogram-private');
        expect(asset.purpose).toBe('post-image');
        expect(asset.mimeType).toBe('image/png');
        expect(asset.size).toBe(1024);
        expect(asset.originalName).toBe('photo.png');
        expect(asset.expiresAt).toEqual(at(TTL));
        expect(asset.id).toEqual(expect.any(String));
      });

      it.each([0, UPLOAD_MAX_BYTES + 1])(
        'rejects declared size %i',
        (declaredSize) => {
          expect(() => pending({ declaredSize })).toThrow(UploadTooLargeError);
        },
      );

      it('accepts exactly UPLOAD_MAX_BYTES', () => {
        expect(pending({ declaredSize: UPLOAD_MAX_BYTES }).size).toBe(
          UPLOAD_MAX_BYTES,
        );
      });

      it('rejects a mime outside the purpose allowlist', () => {
        expect(() => pending({ declaredMime: 'application/pdf' })).toThrow(
          UploadTypeNotAllowedError,
        );
        expect(() =>
          pending({ purpose: 'avatar', declaredMime: 'video/mp4' }),
        ).toThrow(UploadTypeNotAllowedError);
      });

      it('allows chat-only types for chat attachments', () => {
        expect(
          pending({
            purpose: 'chat-attachment',
            declaredMime: 'application/pdf',
          }).mimeType,
        ).toBe('application/pdf');
      });

      it('keys public purposes under pending/ and chat under chat/', () => {
        const post = pending();
        const avatar = pending({ purpose: 'avatar' });
        const chat = pending({ purpose: 'chat-attachment' });

        expect(post.storageKey).toBe(`pending/user-1/${post.id}`);
        expect(avatar.storageKey).toBe(`pending/user-1/${avatar.id}`);
        expect(chat.storageKey).toBe(`chat/user-1/${chat.id}`);
      });

      it('sanitizes the file name and allows none', () => {
        expect(pending({ fileName: '../x/evil.png' }).originalName).toBe(
          'evil.png',
        );
        expect(pending({ fileName: undefined }).originalName).toBeNull();
      });
    });

    describe('assertStoredSizeAcceptable', () => {
      it.each([0, UPLOAD_MAX_BYTES + 1])('rejects %i bytes', (size) => {
        expect(() => pending().assertStoredSizeAcceptable(size)).toThrow(
          UploadTooLargeError,
        );
      });

      it('accepts exactly UPLOAD_MAX_BYTES', () => {
        expect(() =>
          pending().assertStoredSizeAcceptable(UPLOAD_MAX_BYTES),
        ).not.toThrow();
      });
    });

    describe('assertConfirmableBy', () => {
      it('passes for the owner up to 60 s after expiry', () => {
        const asset = pending();

        expect(() => asset.assertConfirmableBy('user-1', NOW)).not.toThrow();
        expect(() =>
          asset.assertConfirmableBy('user-1', at(TTL + 60)),
        ).not.toThrow();
      });

      it('throws UploadExpiredError past the 60 s grace', () => {
        expect(() =>
          pending().assertConfirmableBy('user-1', at(TTL + 61)),
        ).toThrow(UploadExpiredError);
      });

      it('reports another user as not found', () => {
        expect(() => pending().assertConfirmableBy('user-2', NOW)).toThrow(
          EntityByIdNotFoundError,
        );
      });

      it('throws UploadNotPendingError once confirmed', () => {
        const asset = pending();
        asset.confirm(confirmProps);

        expect(() => asset.assertConfirmableBy('user-1', NOW)).toThrow(
          UploadNotPendingError,
        );
      });
    });

    describe('confirm', () => {
      it('sets READY, the detected mime, actual size and location', () => {
        const asset = pending();

        asset.confirm(confirmProps);

        expect(asset.status).toBe('READY');
        expect(asset.mimeType).toBe('image/jpeg');
        expect(asset.size).toBe(2048);
        expect(asset.bucket).toBe('innogram-assets');
        expect(asset.storageKey).toBe('posts/user-1/x');
        expect(asset.url).toBe(confirmProps.url);
        expect(asset.expiresAt).toBeNull();
      });

      it.each<UploadPurpose>(['post-image', 'avatar'])(
        'makes %s PUBLIC',
        (purpose) => {
          const asset = pending({ purpose });
          asset.confirm(confirmProps);
          expect(asset.visibility).toBe('PUBLIC');
        },
      );

      it('keeps chat attachments PRIVATE', () => {
        const asset = pending({ purpose: 'chat-attachment' });
        asset.confirm({ ...confirmProps, url: null });
        expect(asset.visibility).toBe('PRIVATE');
      });

      it('is allowed only from PENDING', () => {
        const asset = pending();
        asset.confirm(confirmProps);

        expect(() => asset.confirm(confirmProps)).toThrow(
          UploadNotPendingError,
        );
      });
    });

    describe('reject', () => {
      it('soft-deletes a pending asset', () => {
        const asset = pending();

        asset.reject();

        expect(asset.deletedAt).toBeInstanceOf(Date);
      });
    });

    describe('assertAttachableTo', () => {
      it('throws UploadNotReadyError while PENDING', () => {
        expect(() => pending().assertAttachableTo('post', 'user-1')).toThrow(
          UploadNotReadyError,
        );
      });

      it('rejects another user', () => {
        expect(() =>
          ready('post-image').assertAttachableTo('post', 'user-2'),
        ).toThrow(AssetNotAttachableError);
      });

      it.each<[UploadPurpose, 'post' | 'avatar' | 'message', boolean]>([
        ['post-image', 'post', true],
        ['post-image', 'avatar', true],
        ['post-image', 'message', false],
        ['avatar', 'post', false],
        ['avatar', 'avatar', true],
        ['avatar', 'message', false],
        ['chat-attachment', 'post', false],
        ['chat-attachment', 'avatar', false],
        ['chat-attachment', 'message', true],
      ])('%s → %s: %s', (purpose, target, ok) => {
        const attach = () =>
          ready(purpose).assertAttachableTo(target, 'user-1');
        if (ok) expect(attach).not.toThrow();
        else expect(attach).toThrow(AssetNotAttachableError);
      });

      it('lets legacy null-purpose rows pass by visibility', () => {
        const publicLegacy = Asset.create({
          uploaderId: 'user-1',
          url: 'http://x/a.png',
          mimeType: 'image/png',
          size: 1,
        });
        publicLegacy.purpose = null;
        const privateLegacy = Asset.createPrivate(privateProps);
        privateLegacy.purpose = null;

        expect(() =>
          publicLegacy.assertAttachableTo('post', 'user-1'),
        ).not.toThrow();
        expect(() =>
          publicLegacy.assertAttachableTo('avatar', 'user-1'),
        ).not.toThrow();
        expect(() =>
          publicLegacy.assertAttachableTo('message', 'user-1'),
        ).toThrow(AssetNotAttachableError);
        expect(() =>
          privateLegacy.assertAttachableTo('message', 'user-1'),
        ).not.toThrow();
        expect(() =>
          privateLegacy.assertAttachableTo('post', 'user-1'),
        ).toThrow(AssetNotAttachableError);
      });
    });

    describe('isSweepable', () => {
      it('is true only for PENDING rows expired longer than the grace', () => {
        const asset = pending();

        expect(asset.isSweepable(at(TTL + 60), 60)).toBe(false);
        expect(asset.isSweepable(at(TTL + 61), 60)).toBe(true);
      });

      it('is false once READY', () => {
        const asset = pending();
        asset.confirm(confirmProps);

        expect(asset.isSweepable(at(TTL + 3600), 60)).toBe(false);
      });
    });
  });
});
