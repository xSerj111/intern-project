import type { AppConfigService } from '../../../config/app-config.service';
import { RecipientContact } from '../domain/entities/recipient-contact.entity';
import type { IRecipientContactRepository } from '../domain/interfaces/recipient-contact-repository.port';
import { AuthDirectoryAdapter } from './auth-directory.adapter';

const USER_ID = '7d4f0f0e-6d4e-4b0a-9a53-3f6f8f0a1111';
const HOUR_MS = 60 * 60 * 1000;

describe('AuthDirectoryAdapter', () => {
  let findByUserId: jest.Mock;
  let save: jest.Mock;
  let contacts: IRecipientContactRepository;
  let fetchMock: jest.SpyInstance;
  let adapter: AuthDirectoryAdapter;

  const respond = (status: number, body?: unknown) =>
    fetchMock.mockResolvedValue({
      status,
      ok: status >= 200 && status < 300,
      json: () => Promise.resolve(body),
    });

  beforeEach(() => {
    findByUserId = jest.fn().mockResolvedValue(null);
    save = jest.fn((c: RecipientContact) => Promise.resolve(c));
    contacts = { findByUserId, save };
    fetchMock = jest.spyOn(global, 'fetch');
    const config = {
      authInternalUrl: 'http://auth.internal:3012/',
      internalApiToken: 'secret-token',
    } as AppConfigService;
    adapter = new AuthDirectoryAdapter(config, contacts);
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns the cached email without calling auth when fresh', async () => {
    findByUserId.mockResolvedValue(
      RecipientContact.create(USER_ID, 'cached@x.io', new Date()),
    );

    await expect(adapter.getEmail(USER_ID)).resolves.toBe('cached@x.io');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches with the internal token and caches on a miss', async () => {
    respond(200, { userId: USER_ID, email: 'new@x.io' });

    await expect(adapter.getEmail(USER_ID)).resolves.toBe('new@x.io');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `http://auth.internal:3012/internal/users/${USER_ID}/contact`,
    );
    expect(init.headers).toEqual({ 'X-Internal-Token': 'secret-token' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, email: 'new@x.io' }),
    );
  });

  it('refreshes a stale row in place', async () => {
    const stale = RecipientContact.create(
      USER_ID,
      'old@x.io',
      new Date(Date.now() - 25 * HOUR_MS),
    );
    findByUserId.mockResolvedValue(stale);
    respond(200, { userId: USER_ID, email: 'fresh@x.io' });

    await expect(adapter.getEmail(USER_ID)).resolves.toBe('fresh@x.io');
    expect(save).toHaveBeenCalledWith(stale);
    expect(stale.email).toBe('fresh@x.io');
    expect(stale.isStale(new Date())).toBe(false);
  });

  it('returns null for an unknown user and caches nothing', async () => {
    respond(404);

    await expect(adapter.getEmail(USER_ID)).resolves.toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('throws when auth answers with an error status', async () => {
    respond(401);

    await expect(adapter.getEmail(USER_ID)).rejects.toThrow('status 401');
  });

  it('throws when auth is unreachable, even with a stale row', async () => {
    findByUserId.mockResolvedValue(
      RecipientContact.create(
        USER_ID,
        'old@x.io',
        new Date(Date.now() - 25 * HOUR_MS),
      ),
    );
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(adapter.getEmail(USER_ID)).rejects.toThrow('ECONNREFUSED');
  });

  it('throws on a malformed body', async () => {
    respond(200, { userId: USER_ID });

    await expect(adapter.getEmail(USER_ID)).rejects.toThrow('no email');
  });
});
