import { Asset, ASSET_ORIGINAL_NAME_MAX_LENGTH } from './asset.entity';
import { MissingStorageKeyError } from '../errors/asset.errors';

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
});
