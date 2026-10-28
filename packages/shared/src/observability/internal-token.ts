import { createHash, timingSafeEqual } from 'crypto';

export const INTERNAL_TOKEN_HEADER = 'x-internal-token';
export const MIN_INTERNAL_API_TOKEN_LENGTH = 32;

/** Minimal structural types so the middleware fits Express without a dependency on it. */
interface InternalTokenRequest {
  headers: Record<string, string | string[] | undefined>;
}

interface InternalTokenResponse {
  status(code: number): { json(body: unknown): unknown };
}

type NextFn = (err?: unknown) => void;

const sha256 = (value: string): Buffer =>
  createHash('sha256').update(value, 'utf8').digest();

/**
 * Constant-time comparison of a presented `X-Internal-Token` against the
 * expected value. Both sides are hashed first, so inputs of any length compare
 * in the same time and `timingSafeEqual` never sees mismatched buffers.
 */
export function isValidInternalToken(
  header: unknown,
  expected: string,
): boolean {
  const provided = typeof header === 'string' ? header : '';
  const matches = timingSafeEqual(sha256(provided), sha256(expected ?? ''));
  return (
    matches &&
    typeof header === 'string' &&
    typeof expected === 'string' &&
    expected.length > 0
  );
}

/** Fail-fast startup check: the token must be a string of at least 32 chars. */
export function assertInternalApiToken(
  value: unknown,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length < MIN_INTERNAL_API_TOKEN_LENGTH
  ) {
    throw new Error(
      `INTERNAL_API_TOKEN must be set and at least ${MIN_INTERNAL_API_TOKEN_LENGTH} characters long`,
    );
  }
}

/** Express-compatible middleware rejecting requests without a valid `X-Internal-Token`. */
export function requireInternalToken(expected: string) {
  return (
    req: InternalTokenRequest,
    res: InternalTokenResponse,
    next: NextFn,
  ): void => {
    if (!isValidInternalToken(req.headers[INTERNAL_TOKEN_HEADER], expected)) {
      res.status(401).json({ statusCode: 401, message: 'Unauthorized' });
      return;
    }
    next();
  };
}
