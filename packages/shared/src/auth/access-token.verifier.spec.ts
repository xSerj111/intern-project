import { createHmac } from "node:crypto";

import { AccessTokenVerifier } from "./access-token.verifier";

const SECRET = "test-secret-test-secret-test-secret";

const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** Builds a signed token with node:crypto (HS256 unless `alg` says otherwise). */
const sign = (
  payload: Record<string, unknown>,
  secret = SECRET,
  alg = "HS256",
) => {
  const head = `${b64({ alg, typ: "JWT" })}.${b64(payload)}`;
  const sig = createHmac("sha256", secret).update(head).digest("base64url");
  return `${head}.${sig}`;
};

const future = () => Math.floor(Date.now() / 1000) + 600;
const claims = (extra: Record<string, unknown> = {}) => ({
  sub: "user-1",
  email: "a@b.c",
  jti: "jti-1",
  exp: future(),
  ...extra,
});

describe("AccessTokenVerifier", () => {
  const notRevoked = () => jest.fn().mockResolvedValue(false);

  it("reports a missing token", async () => {
    const sut = new AccessTokenVerifier(SECRET, notRevoked());
    await expect(sut.verify(undefined)).resolves.toEqual({
      ok: false,
      reason: "missing",
    });
    await expect(sut.verify("")).resolves.toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("accepts a valid token and returns the payload", async () => {
    const isRevoked = notRevoked();
    const sut = new AccessTokenVerifier(SECRET, isRevoked);
    const exp = future();

    const result = await sut.verify(sign(claims({ exp, sid: "sess-1" })));

    expect(result).toEqual({
      ok: true,
      payload: {
        sub: "user-1",
        email: "a@b.c",
        jti: "jti-1",
        sid: "sess-1",
        exp,
      },
    });
    expect(isRevoked).toHaveBeenCalledWith("jti-1");
  });

  it("leaves sid undefined when the claim is not a string", async () => {
    const sut = new AccessTokenVerifier(SECRET, notRevoked());
    const result = await sut.verify(sign(claims({ sid: 5 })));
    expect(result.ok && result.payload.sid).toBeUndefined();
  });

  it("rejects a token signed with another secret", async () => {
    const sut = new AccessTokenVerifier(SECRET, notRevoked());
    await expect(
      sut.verify(sign(claims(), "other-secret-other-secret-other")),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects an expired token", async () => {
    const sut = new AccessTokenVerifier(SECRET, notRevoked());
    const expired = sign(claims({ exp: Math.floor(Date.now() / 1000) - 10 }));
    await expect(sut.verify(expired)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects garbage and non-HS256 algorithms", async () => {
    const sut = new AccessTokenVerifier(SECRET, notRevoked());
    await expect(sut.verify("not-a-jwt")).resolves.toMatchObject({
      reason: "invalid",
    });
    await expect(
      sut.verify(sign(claims(), SECRET, "HS512")),
    ).resolves.toMatchObject({
      reason: "invalid",
    });
  });

  it("rejects a validly signed token whose payload is not a JSON object", async () => {
    const sut = new AccessTokenVerifier(SECRET, notRevoked());
    const head = `${b64({ alg: "HS256", typ: "JWT" })}.${Buffer.from("hello").toString("base64url")}`;
    const sig = createHmac("sha256", SECRET).update(head).digest("base64url");
    await expect(sut.verify(`${head}.${sig}`)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it.each([
    ["missing jti", { jti: undefined }],
    ["empty jti", { jti: "" }],
    ["non-string jti", { jti: 7 }],
    ["missing sub", { sub: undefined }],
    ["non-string sub", { sub: 7 }],
    ["missing exp", { exp: undefined }],
  ])("rejects a token with %s", async (_name, override) => {
    const isRevoked = notRevoked();
    const sut = new AccessTokenVerifier(SECRET, isRevoked);
    const payload = { ...claims(), ...override };
    // jwt.verify validates a numeric exp itself; undefined keys drop out of JSON.
    await expect(sut.verify(sign(payload))).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(isRevoked).not.toHaveBeenCalled();
  });

  it("reports a revoked token", async () => {
    const sut = new AccessTokenVerifier(
      SECRET,
      jest.fn().mockResolvedValue(true),
    );
    await expect(sut.verify(sign(claims()))).resolves.toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("fails closed when the blacklist lookup throws", async () => {
    const sut = new AccessTokenVerifier(
      SECRET,
      jest.fn().mockRejectedValue(new Error("redis down")),
    );
    await expect(sut.verify(sign(claims()))).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
