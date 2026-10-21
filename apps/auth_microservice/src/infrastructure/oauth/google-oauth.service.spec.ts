// env.ts fails fast on these at import time, so set them before anything loads it.
process.env.CORE_SERVICE_URL = 'http://localhost:3001';
process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.INTERNAL_API_TOKEN = 'x'.repeat(32);

const verifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken })),
}));

import { OAuth2Client } from 'google-auth-library';
import { UnauthorizedError } from '@repo/shared';
import { GoogleOAuthService } from './google-oauth.service';
import { googleConfig } from '../../config/google';

describe('GoogleOAuthService', () => {
  let service: GoogleOAuthService;

  const ticketWith = (payload: object | undefined) => ({
    getPayload: () => payload,
  });

  beforeEach(() => {
    verifyIdToken.mockReset();
    service = new GoogleOAuthService();
  });

  it('builds the client with the configured client id', () => {
    expect(OAuth2Client).toHaveBeenCalledWith(googleConfig.clientId);
  });

  it('returns email and sub from a valid token, checking the audience', async () => {
    verifyIdToken.mockResolvedValue(
      ticketWith({ email: 'g@gmail.com', sub: 'google-1', name: 'ignored' }),
    );

    await expect(service.verifyIdToken('id-token')).resolves.toEqual({
      email: 'g@gmail.com',
      sub: 'google-1',
    });
    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'id-token',
      audience: googleConfig.clientId,
    });
  });

  it.each([
    ['no payload', undefined],
    ['no email', { sub: 'google-1' }],
    ['no sub', { email: 'g@gmail.com' }],
  ])('rejects a ticket with %s', async (_label, payload) => {
    verifyIdToken.mockResolvedValue(ticketWith(payload));

    await expect(service.verifyIdToken('id-token')).rejects.toThrow(
      new UnauthorizedError('Invalid Google token payload'),
    );
  });

  it('maps a library verification error to UnauthorizedError', async () => {
    verifyIdToken.mockRejectedValue(new Error('Wrong recipient'));

    const result = service.verifyIdToken('id-token');

    await expect(result).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(result).rejects.toThrow('Invalid Google token');
  });
});
