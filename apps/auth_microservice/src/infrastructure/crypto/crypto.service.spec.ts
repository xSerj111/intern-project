import bcrypt from 'bcrypt';
import { BcryptService } from './crypto.service';

jest.mock('bcrypt', () => ({
  __esModule: true,
  default: { hash: jest.fn(), compare: jest.fn() },
}));

describe('BcryptService', () => {
  const hash = bcrypt.hash as unknown as jest.Mock;
  const compare = bcrypt.compare as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    hash.mockResolvedValue('hashed');
  });

  it('hashes with the default 10 rounds', async () => {
    await expect(new BcryptService().hash('secret')).resolves.toBe('hashed');
    expect(hash).toHaveBeenCalledWith('secret', 10);
  });

  it('hashes with the rounds given to the constructor', async () => {
    await new BcryptService(4).hash('secret');
    expect(hash).toHaveBeenCalledWith('secret', 4);
  });

  it('prefers the per-call rounds over the default', async () => {
    await new BcryptService(4).hash('secret', 6);
    expect(hash).toHaveBeenCalledWith('secret', 6);
  });

  it('falls back to the default when per-call rounds is 0', async () => {
    await new BcryptService(4).hash('secret', 0);
    expect(hash).toHaveBeenCalledWith('secret', 4);
  });

  it('compare delegates to bcrypt and returns its result', async () => {
    compare.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const service = new BcryptService();

    await expect(service.compare('secret', 'hashed')).resolves.toBe(true);
    await expect(service.compare('wrong', 'hashed')).resolves.toBe(false);
    expect(compare).toHaveBeenCalledWith('secret', 'hashed');
  });
});
