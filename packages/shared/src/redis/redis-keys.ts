/**
 * Redis key layout shared by auth (writes) and core (reads), so both services
 * agree on the exact strings.
 */
export const RedisKeys = {
  /** Refresh-token session: JSON `{ userId, sid, ipAddress, userAgent, expiresAt }`. */
  refreshSession: (id: string) => `refresh_tokens:${id}`,
  /** Revoked or already-rotated refresh token (value `true`, TTL = time left). */
  refreshBlacklist: (id: string) => `blacklist:refresh:${id}`,
  /** Revoked access token, keyed by its `jti` (value `true`, TTL = time left). */
  accessBlacklist: (jti: string) => `blacklist:access:${jti}`,
  /** Pub/sub channel carrying `SessionRevokedEvent` JSON on logout. */
  sessionRevokedChannel: "auth:session-revoked",
};

/** Whole seconds until a unix-seconds `exp`, never negative. */
export const secondsUntil = (expUnix: number): number =>
  Math.max(0, expUnix - Math.floor(Date.now() / 1000));
