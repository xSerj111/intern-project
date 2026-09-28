/**
 * Client runtime configuration.
 *
 * Values are injected at build/dev time by `next.config.ts` from the repo-root
 * `.env` and are intentionally limited to browser-safe (`NEXT_PUBLIC_*`) keys.
 * No backend secret (JWT secret, database, Redis, SMTP, S3, ...) is exposed here.
 */
export interface ClientConfig {
  /** Base URL of the auth service (`AUTH_SERVICE_URL`). */
  authServiceUrl: string;
  /** Base URL of the core service (`CORE_SERVICE_URL`). */
  coreServiceUrl: string;
  /** The client's own port (`CLIENT_PORT`, default 3000). */
  clientPort: number;
  /** Google OAuth *client* id (`GOOGLE_CLIENT_ID`). Empty when unconfigured. */
  googleClientId: string;
}

export const config: ClientConfig = {
  authServiceUrl:
    process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? 'http://localhost:3002',
  coreServiceUrl:
    process.env.NEXT_PUBLIC_CORE_SERVICE_URL ?? 'http://localhost:3001',
  clientPort: Number(process.env.NEXT_PUBLIC_CLIENT_PORT ?? '3000'),
  googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '',
};
