import * as jwt from "jsonwebtoken";

export type VerifyResult =
  | {
      ok: true;
      payload: {
        sub: string;
        email: string;
        jti: string;
        sid?: string;
        exp: number;
      };
    }
  | { ok: false; reason: "missing" | "invalid" | "revoked" | "unavailable" };

/**
 * Verifies an access JWT and checks the revocation blacklist.
 * Fails closed: if the blacklist lookup throws, the result is `unavailable`.
 */
export class AccessTokenVerifier {
  constructor(
    private readonly secret: string,
    private readonly isRevoked: (jti: string) => Promise<boolean>,
  ) {}

  async verify(token: string | undefined): Promise<VerifyResult> {
    if (!token) return { ok: false, reason: "missing" };

    let decoded: jwt.JwtPayload;
    try {
      const result = jwt.verify(token, this.secret, { algorithms: ['HS256'] });
      if (typeof result === "string") return { ok: false, reason: "invalid" };
      decoded = result;
    } catch {
      return { ok: false, reason: "invalid" };
    }

    if (
      typeof decoded.jti !== "string" ||
      !decoded.jti ||
      typeof decoded.sub !== "string" ||
      typeof decoded.exp !== "number"
    ) {
      return { ok: false, reason: "invalid" };
    }

    try {
      if (await this.isRevoked(decoded.jti)) {
        return { ok: false, reason: "revoked" };
      }
    } catch {
      return { ok: false, reason: "unavailable" };
    }

    return {
      ok: true,
      payload: {
        sub: decoded.sub,
        email: decoded.email as string,
        jti: decoded.jti,
        sid: typeof decoded.sid === "string" ? decoded.sid : undefined,
        exp: decoded.exp,
      },
    };
  }
}
