import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import type { AppConfigService } from '../../../config/app-config.service';
import { ObjectStorageCheck } from './object-storage.check';

jest.mock('@aws-sdk/client-s3', () => {
  const actual =
    jest.requireActual<typeof import('@aws-sdk/client-s3')>(
      '@aws-sdk/client-s3',
    );
  return { ...actual, S3Client: jest.fn() };
});

const s3Config = {
  endpoint: 'seaweed',
  port: 9000,
  useSsl: false,
  region: 'us-east-1',
  accessKey: 'ak',
  secretKey: 'sk',
  privateBucket: 'private-bucket',
};

describe('ObjectStorageCheck', () => {
  const send = jest.fn();
  const destroy = jest.fn();
  const S3ClientMock = S3Client as unknown as jest.Mock;
  let config: { s3: typeof s3Config };
  let check: ObjectStorageCheck;

  beforeEach(() => {
    jest.resetAllMocks();
    S3ClientMock.mockImplementation(() => ({ send, destroy }));
    config = { s3: { ...s3Config } };
    check = new ObjectStorageCheck(config as unknown as AppConfigService);
  });

  it('is a non-critical check named object_storage', () => {
    expect(check.name).toBe('object_storage');
    expect(check.critical).toBe(false);
  });

  it('heads the private bucket with a bounded abort signal', async () => {
    send.mockResolvedValue({});

    await expect(check.run()).resolves.toBeUndefined();

    const [command, options] = send.mock.calls[0] as [
      HeadBucketCommand,
      { abortSignal: AbortSignal },
    ];
    expect(command).toBeInstanceOf(HeadBucketCommand);
    expect(command.input).toEqual({ Bucket: 'private-bucket' });
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    expect(options.abortSignal.aborted).toBe(false);
  });

  it('builds a fail-fast path-style client over http', async () => {
    send.mockResolvedValue({});

    await check.run();

    expect(S3ClientMock).toHaveBeenCalledWith({
      endpoint: 'http://seaweed:9000',
      region: 'us-east-1',
      credentials: { accessKeyId: 'ak', secretAccessKey: 'sk' },
      forcePathStyle: true,
      maxAttempts: 1,
    });
  });

  it('uses https when SSL is enabled', async () => {
    config.s3.useSsl = true;
    send.mockResolvedValue({});

    await check.run();

    expect(S3ClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://seaweed:9000' }),
    );
  });

  it('reuses one client across probes', async () => {
    send.mockResolvedValue({});

    await check.run();
    await check.run();

    expect(S3ClientMock).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('rejects when the bucket is missing or unreachable', async () => {
    send.mockRejectedValue(new Error('NotFound'));

    await expect(check.run()).rejects.toThrow('NotFound');
  });

  it('rejects when the request is aborted by the timeout', async () => {
    const timeout = new Error('The operation was aborted');
    timeout.name = 'TimeoutError';
    send.mockRejectedValue(timeout);

    await expect(check.run()).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('destroys the client on module destroy once created', async () => {
    send.mockResolvedValue({});
    await check.run();

    check.onModuleDestroy();

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('does nothing on module destroy when no client was created', () => {
    expect(() => check.onModuleDestroy()).not.toThrow();
    expect(destroy).not.toHaveBeenCalled();
  });
});
