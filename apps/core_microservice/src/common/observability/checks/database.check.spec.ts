import type { DataSource } from 'typeorm';
import { DatabaseCheck } from './database.check';

describe('DatabaseCheck', () => {
  const query = jest.fn();
  const check = new DatabaseCheck({ query } as unknown as DataSource);

  beforeEach(() => jest.resetAllMocks());

  it('is a critical check named database', () => {
    expect(check.name).toBe('database');
    expect(check.critical).toBe(true);
  });

  it('resolves when SELECT 1 succeeds', async () => {
    query.mockResolvedValue([{ '?column?': 1 }]);

    await expect(check.run()).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('rejects when the connection is down', async () => {
    query.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(check.run()).rejects.toThrow('ECONNREFUSED');
  });
});
