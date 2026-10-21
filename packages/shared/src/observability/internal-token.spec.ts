import {
  assertInternalApiToken,
  isValidInternalToken,
  requireInternalToken,
} from './internal-token';

const TOKEN = 'a'.repeat(32) + '-internal-secret';

describe('isValidInternalToken', () => {
  it('rejects a missing header', () => {
    expect(isValidInternalToken(undefined, TOKEN)).toBe(false);
  });

  it('rejects a wrong token of the same length', () => {
    const wrong = 'b' + TOKEN.slice(1);
    expect(wrong).toHaveLength(TOKEN.length);
    expect(isValidInternalToken(wrong, TOKEN)).toBe(false);
  });

  it('rejects a wrong token of a different length', () => {
    expect(isValidInternalToken('short', TOKEN)).toBe(false);
    expect(isValidInternalToken(TOKEN + 'x', TOKEN)).toBe(false);
  });

  it('accepts the correct token', () => {
    expect(isValidInternalToken(TOKEN, TOKEN)).toBe(true);
  });

  it('rejects an array header', () => {
    expect(isValidInternalToken([TOKEN], TOKEN)).toBe(false);
  });

  it('always rejects when the expected token is empty', () => {
    expect(isValidInternalToken('', '')).toBe(false);
  });
});

describe('assertInternalApiToken', () => {
  it('throws on a missing value', () => {
    expect(() => assertInternalApiToken(undefined)).toThrow();
  });

  it('throws on a short value without echoing it', () => {
    expect(() => assertInternalApiToken('too-short-secret')).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('too-short-secret') as string,
      }),
    );
  });

  it('accepts a value of at least 32 characters', () => {
    expect(() => assertInternalApiToken('x'.repeat(32))).not.toThrow();
  });
});

describe('requireInternalToken', () => {
  const run = (headers: Record<string, string | string[] | undefined>) => {
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) };
    const next = jest.fn();
    requireInternalToken(TOKEN)({ headers }, res, next);
    return { res, json, next };
  };

  it('responds 401 with the contract body when the header is missing', () => {
    const { res, json, next } = run({});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      statusCode: 401,
      message: 'Unauthorized',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 401 when the header is wrong', () => {
    const { res, next } = run({ 'x-internal-token': 'nope' });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when the header matches', () => {
    const { res, next } = run({ 'x-internal-token': TOKEN });
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });
});
