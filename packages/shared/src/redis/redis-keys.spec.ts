import { RedisKeys, secondsUntil } from "./redis-keys";

describe("RedisKeys", () => {
  it("builds the shared key layout", () => {
    expect(RedisKeys.refreshSession("s1")).toBe("refresh_tokens:s1");
    expect(RedisKeys.refreshBlacklist("r1")).toBe("blacklist:refresh:r1");
    expect(RedisKeys.accessBlacklist("j1")).toBe("blacklist:access:j1");
    expect(RedisKeys.sessionRevokedChannel).toBe("auth:session-revoked");
  });
});

describe("secondsUntil", () => {
  afterEach(() => jest.useRealTimers());

  it("returns whole seconds until a future exp", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00.500Z"));
    const now = Math.floor(Date.now() / 1000);
    expect(secondsUntil(now + 60)).toBe(60);
  });

  it("never goes negative", () => {
    expect(secondsUntil(0)).toBe(0);
  });
});
