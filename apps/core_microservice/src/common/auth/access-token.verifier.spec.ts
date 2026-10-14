import * as jwt from 'jsonwebtoken';
import { AccessTokenVerifier } from '@repo/shared';

const SECRET = 'test-secret';

describe('AccessTokenVerifier', () => {
  let isRevoked: jest.Mock;
  let verifier: AccessTokenVerifier;

  const sign = (
    payload: Record<string, unknown> = { sub: 'user-1', email: 'a@b.com' },
    options: jwt.SignOptions = { jwtid: 'jti-1', expiresIn: 60 },
  ) => jwt.sign(payload, SECRET, options);

  beforeEach(() => {
    isRevoked = jest.fn().mockResolvedValue(false);
    verifier = new AccessTokenVerifier(SECRET, isRevoked);
  });

  it('accepts a valid token and exposes sid', async () => {
    const token = sign({ sub: 'user-1', email: 'a@b.com', sid: 'sid-1' });

    const result = await verifier.verify(token);

    expect(result).toMatchObject({
      ok: true,
      payload: { sub: 'user-1', jti: 'jti-1', sid: 'sid-1' },
    });
    expect(isRevoked).toHaveBeenCalledWith('jti-1');
  });

  it('returns missing when no token is given', async () => {
    await expect(verifier.verify(undefined)).resolves.toEqual({
      ok: false,
      reason: 'missing',
    });
  });

  it('returns invalid for a tampered token', async () => {
    const token = sign() + 'x';
    await expect(verifier.verify(token)).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('returns invalid for an expired token', async () => {
    const token = sign(undefined, { jwtid: 'jti-1', expiresIn: -10 });
    await expect(verifier.verify(token)).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('returns invalid for a token without jti', async () => {
    await expect(
      verifier.verify(sign(undefined, { expiresIn: 60 })),
    ).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(isRevoked).not.toHaveBeenCalled();
  });

  it('returns revoked for a blacklisted jti', async () => {
    isRevoked.mockResolvedValue(true);
    await expect(verifier.verify(sign())).resolves.toEqual({
      ok: false,
      reason: 'revoked',
    });
  });

  it('returns unavailable when the revocation check throws', async () => {
    isRevoked.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(verifier.verify(sign())).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });
});
