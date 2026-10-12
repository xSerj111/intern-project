import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';

// The monorepo keeps a single root `.env` (constitution I / AGENTS.md). Next only
// loads env files from its own project directory, so load the repo-root file here
// and expose only browser-safe values through `NEXT_PUBLIC_*`.
const rootEnvPath = resolve(__dirname, '../../.env');
if (existsSync(rootEnvPath)) {
  loadEnv({ path: rootEnvPath });
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Lint is a first-class turbo task (`turbo run lint`); don't run a second,
  // differently-configured ESLint pass inside `next build`.
  eslint: {
    ignoreDuringBuilds: true,
  },
  env: {
    // Only service URLs, the client's own port, and the Google *client* id —
    // never backend secrets (JWT secret, Google client *secret*, DB, Redis, ...).
    NEXT_PUBLIC_AUTH_SERVICE_URL: process.env.AUTH_SERVICE_URL ?? '',
    NEXT_PUBLIC_CORE_SERVICE_URL: process.env.CORE_SERVICE_URL ?? '',
    NEXT_PUBLIC_CLIENT_PORT: process.env.CLIENT_PORT ?? '3000',
    // Google OAuth *client* id is a public identifier, not a secret.
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
  },
};

export default nextConfig;
