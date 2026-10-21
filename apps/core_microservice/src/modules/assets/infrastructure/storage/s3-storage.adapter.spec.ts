import { Readable } from 'stream';
import { InternalServerErrorException, Logger } from '@nestjs/common';
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import {
  S3StorageAdapter,
  buildAttachmentDisposition,
} from './s3-storage.adapter';
import { AppConfigService } from '../../../../config/app-config.service';

describe('buildAttachmentDisposition', () => {
  it('quotes a plain ASCII name and repeats it in filename*', () => {
    expect(buildAttachmentDisposition('report.pdf')).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
  });

  it('replaces non-ASCII characters in the fallback and percent-encodes filename*', () => {
    const header = buildAttachmentDisposition('zdjęcie.pdf');

    expect(header).toContain('filename="zdj_cie.pdf"');
    expect(header).toContain(`filename*=UTF-8''zdj%C4%99cie.pdf`);
  });

  it('escapes quotes and backslashes in the fallback', () => {
    const header = buildAttachmentDisposition('a"b\\c.txt');

    expect(header).toContain('filename="a\\"b\\\\c.txt"');
  });

  it("percent-encodes ' ( ) * in filename*", () => {
    const header = buildAttachmentDisposition("it's (a)*.txt");

    expect(header).toContain(`filename*=UTF-8''it%27s%20%28a%29%2A.txt`);
  });
});

describe('S3StorageAdapter', () => {
  const appConfig = {
    s3: {
      endpoint: 'storage',
      port: 9000,
      useSsl: false,
      region: 'us-east-1',
      bucketName: 'public-bucket',
      privateBucket: 'private-bucket',
      publicEndpoint: 'http://localhost:9000',
      accessKey: 'access',
      secretKey: 'secret',
    },
    uploads: { linkTtlSec: 300 },
  } as unknown as AppConfigService;

  let adapter: S3StorageAdapter;
  let send: jest.SpyInstance;

  beforeEach(() => {
    adapter = new S3StorageAdapter(appConfig);
    send = jest.spyOn(S3Client.prototype, 'send');
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const firstCommand = (): unknown => (send.mock.calls as unknown[][])[0][0];

  const notFound = () =>
    Object.assign(new Error('NotFound'), {
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    });

  describe('presignPost', () => {
    const decodePolicy = (fields: Record<string, string>) =>
      JSON.parse(Buffer.from(fields.Policy, 'base64').toString('utf8')) as {
        expiration: string;
        conditions: unknown[];
      };

    it('pins bucket, exact key, size range and Content-Type against the public endpoint', async () => {
      const before = Date.now();
      const { url, fields } = await adapter.presignPost({
        bucket: 'private-bucket',
        key: 'pending/u1/a1',
        contentType: 'image/png',
        maxBytes: 10485760,
      });

      expect(url).toBe('http://localhost:9000/private-bucket');
      expect(fields.key).toBe('pending/u1/a1');
      expect(fields['Content-Type']).toBe('image/png');
      const policy = decodePolicy(fields);
      expect(policy.conditions).toEqual(
        expect.arrayContaining([
          { bucket: 'private-bucket' },
          { key: 'pending/u1/a1' },
          ['content-length-range', 1, 10485760],
          { 'Content-Type': 'image/png' },
        ]),
      );
      expect(JSON.stringify(policy.conditions)).not.toContain('starts-with');
      const ttlMs = Date.parse(policy.expiration) - before;
      expect(ttlMs).toBeGreaterThan(290_000);
      expect(ttlMs).toBeLessThanOrEqual(301_000);
      expect(send).not.toHaveBeenCalled();
    });

    it('caps maxBytes at UPLOAD_MAX_BYTES and honours expiresSec', async () => {
      const before = Date.now();
      const { fields } = await adapter.presignPost({
        bucket: 'private-bucket',
        key: 'chat/u1/a1',
        contentType: 'text/plain',
        maxBytes: 50 * 1024 * 1024,
        expiresSec: 60,
      });

      const policy = decodePolicy(fields);
      expect(policy.conditions).toContainEqual([
        'content-length-range',
        1,
        10485760,
      ]);
      expect(Date.parse(policy.expiration) - before).toBeLessThanOrEqual(
        61_000,
      );
    });

    it('rejects a key that would turn into a starts-with condition', async () => {
      await expect(
        adapter.presignPost({
          bucket: 'private-bucket',
          key: 'pending/${filename}',
          contentType: 'image/png',
          maxBytes: 100,
        }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('head', () => {
    it('returns size and content type', async () => {
      send.mockResolvedValue({ ContentLength: 1234, ContentType: 'image/png' });

      await expect(adapter.head('private-bucket', 'k')).resolves.toEqual({
        size: 1234,
        contentType: 'image/png',
      });
      const cmd = firstCommand() as HeadObjectCommand;
      expect(cmd).toBeInstanceOf(HeadObjectCommand);
      expect(cmd.input).toEqual({ Bucket: 'private-bucket', Key: 'k' });
    });

    it('returns null on 404', async () => {
      send.mockRejectedValue(notFound());

      await expect(adapter.head('private-bucket', 'k')).resolves.toBeNull();
    });

    it('throws on other storage errors', async () => {
      send.mockRejectedValue(new Error('boom'));

      await expect(adapter.head('private-bucket', 'k')).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });

  describe('readHead', () => {
    it('sends a ranged GET for the first n bytes', async () => {
      send.mockResolvedValue({ Body: Readable.from([Buffer.from('abcd')]) });

      const buf = await adapter.readHead('private-bucket', 'k', 4100);

      expect(buf.toString()).toBe('abcd');
      const cmd = firstCommand() as GetObjectCommand;
      expect(cmd).toBeInstanceOf(GetObjectCommand);
      expect(cmd.input).toEqual({
        Bucket: 'private-bucket',
        Key: 'k',
        Range: 'bytes=0-4099',
      });
    });

    it('never returns more than n bytes when the server ignores Range', async () => {
      const body = Readable.from([
        Buffer.alloc(3, 1),
        Buffer.alloc(3, 2),
        Buffer.alloc(1000, 3),
      ]);
      send.mockResolvedValue({ Body: body });

      const buf = await adapter.readHead('private-bucket', 'k', 5);

      expect(buf).toEqual(Buffer.from([1, 1, 1, 2, 2]));
      expect(body.destroyed).toBe(true);
    });

    it('returns an empty buffer for an empty body', async () => {
      send.mockResolvedValue({ Body: undefined });

      await expect(
        adapter.readHead('private-bucket', 'k', 10),
      ).resolves.toEqual(Buffer.alloc(0));
    });
  });

  describe('copyToPublic', () => {
    it('copies inside storage into the public bucket and returns the public URL', async () => {
      send.mockResolvedValue({});

      const url = await adapter.copyToPublic(
        'private-bucket',
        'pending/u1/a 1',
        'a1.png',
      );

      expect(url).toBe('http://storage:9000/public-bucket/a1.png');
      const cmd = firstCommand() as CopyObjectCommand;
      expect(cmd).toBeInstanceOf(CopyObjectCommand);
      expect(cmd.input).toEqual({
        Bucket: 'public-bucket',
        Key: 'a1.png',
        CopySource: 'private-bucket/pending/u1/a%201',
      });
    });

    it('replaces the content type when given', async () => {
      send.mockResolvedValue({});

      await adapter.copyToPublic('private-bucket', 'k', 'a1.jpg', 'image/jpeg');

      const cmd = firstCommand() as CopyObjectCommand;
      expect(cmd.input).toMatchObject({
        ContentType: 'image/jpeg',
        MetadataDirective: 'REPLACE',
      });
    });

    it('throws when the copy fails', async () => {
      send.mockRejectedValue(new Error('boom'));

      await expect(
        adapter.copyToPublic('private-bucket', 'k', 'a1.png'),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('deleteObject', () => {
    it('deletes from the given bucket', async () => {
      send.mockResolvedValue({});

      await adapter.deleteObject('public-bucket', 'a1.png');

      const cmd = firstCommand() as DeleteObjectCommand;
      expect(cmd).toBeInstanceOf(DeleteObjectCommand);
      expect(cmd.input).toEqual({ Bucket: 'public-bucket', Key: 'a1.png' });
    });

    it('treats a missing object as deleted', async () => {
      send.mockRejectedValue(notFound());

      await expect(
        adapter.deleteObject('private-bucket', 'gone'),
      ).resolves.toBeUndefined();
    });
  });
});
