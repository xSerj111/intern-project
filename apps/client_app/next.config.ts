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

// Server-side env vars that feed the browser-visible service URLs below. A production
// build must not silently ship localhost URLs, so it fails when one is missing.
const requiredServiceUrlVars = [
  'AUTH_SERVICE_URL',
  'CORE_SERVICE_URL',
  'NOTIFICATIONS_SERVICE_URL',
] as const;

const missingServiceUrlVars = requiredServiceUrlVars.filter(
  (name) => !process.env[name],
);
if (missingServiceUrlVars.length > 0) {
  const message = `Missing service URL env var(s): ${missingServiceUrlVars.join(', ')}`;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `${message}. Set them in the root .env before a production build.`,
    );
  }
  console.warn(`[client_app] ${message}. Falling back to localhost defaults.`);
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server for the Docker image (`.next/standalone`). Tracing from
  // the repo root keeps workspace packages and hoisted node_modules in the bundle.
  output: 'standalone',
  outputFileTracingRoot: resolve(__dirname, '../..'),
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
    NEXT_PUBLIC_NOTIFICATIONS_SERVICE_URL:
      process.env.NOTIFICATIONS_SERVICE_URL ?? '',
    NEXT_PUBLIC_CLIENT_PORT: process.env.CLIENT_PORT ?? '3000',
    // Google OAuth *client* id is a public identifier, not a secret.
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
  },
};

export default nextConfig;
