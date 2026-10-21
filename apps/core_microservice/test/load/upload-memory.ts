/**
 * Manual memory check for US6 AS4 / SC-010: core must not buffer uploads.
 *
 * Logs in as a perf seed user, then runs N concurrent uploads of a 10 MiB
 * file through the direct-to-storage flow (POST /uploads -> multipart POST to
 * storage -> POST /uploads/:id/confirm) while sampling core's
 * `process_resident_memory_bytes` from GET /metrics every 250 ms.
 *
 * Usage (needs core on :3001, auth on :3002, the perf seed and storage running):
 *   cd apps/core_microservice
 *   INTERNAL_API_TOKEN=... npm run perf:upload-memory
 *
 * Options:
 *   --uploads <n>   concurrent uploads (default 20)
 *   --core-url <u>  core base URL (default $CORE_URL or http://localhost:3001)
 *   --auth-url <u>  auth base URL (default $AUTH_URL or http://localhost:3002)
 *
 * Env: INTERNAL_API_TOKEN (required, read from the root .env when unset),
 * PERF_PASSWORD (default PerfPassword123!).
 *
 * Exits non-zero when the peak RSS delta is >= 50 MiB or an upload is not confirmed.
 */
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: resolve(__dirname, '../../../../.env'), quiet: true });

const LIMIT_MIB = 50;
const FILE_BYTES = 10 * 1024 * 1024; // UPLOAD_MAX_BYTES in @repo/contracts
const SAMPLE_INTERVAL_MS = 250;
// Same value as INTERNAL_TOKEN_HEADER in @repo/shared (not imported: it pulls in the backend stack).
const INTERNAL_TOKEN_HEADER = 'x-internal-token';
const PERF_EMAIL = 'perf0001@innogram.dev';
const MiB = 1024 * 1024;

interface UploadTicket {
  uploadId: string;
  url: string;
  fields: Record<string, string>;
}

function parseArgs(): { uploads: number; coreUrl: string; authUrl: string } {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const uploads = Number(get('uploads') ?? 20);
  if (!Number.isInteger(uploads) || uploads < 1) {
    throw new Error('--uploads must be a positive integer');
  }
  return {
    uploads,
    coreUrl: get('core-url') ?? process.env.CORE_URL ?? 'http://localhost:3001',
    authUrl: get('auth-url') ?? process.env.AUTH_URL ?? 'http://localhost:3002',
  };
}

/** A PNG signature + IHDR + one oversized IDAT chunk, padded to exactly `size` bytes. */
function buildPng(size: number): Buffer {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const chunk = (type: string, data: Buffer): Buffer => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(data.length, 0);
    header.write(type, 4, 'ascii');
    return Buffer.concat([header, data, Buffer.alloc(4)]); // CRC is not checked
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const head = Buffer.concat([signature, chunk('IHDR', ihdr)]);
  const idatData = Buffer.alloc(size - head.length - 12);
  return Buffer.concat([head, chunk('IDAT', idatData)]);
}

async function readError(res: Response): Promise<string> {
  return `${res.status} ${(await res.text()).slice(0, 200)}`;
}

async function login(authUrl: string): Promise<string> {
  const res = await fetch(`${authUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: PERF_EMAIL,
      password: process.env.PERF_PASSWORD ?? 'PerfPassword123!',
    }),
  });
  if (res.status !== 200) {
    throw new Error(
      `login failed (${await readError(res)}) - is the perf seed loaded?`,
    );
  }
  const body = (await res.json()) as { accessToken?: string };
  if (!body.accessToken) throw new Error('login response has no accessToken');
  return body.accessToken;
}

async function readRss(
  coreUrl: string,
  internalToken: string,
): Promise<number> {
  const res = await fetch(`${coreUrl}/metrics`, {
    headers: { [INTERNAL_TOKEN_HEADER]: internalToken },
  });
  if (res.status !== 200) {
    throw new Error(`GET /metrics failed (${await readError(res)})`);
  }
  const match =
    /^process_resident_memory_bytes(?:\{[^}]*\})?\s+([0-9.eE+-]+)/m.exec(
      await res.text(),
    );
  if (!match) throw new Error('process_resident_memory_bytes not in /metrics');
  return Number(match[1]);
}

async function uploadOne(
  coreUrl: string,
  token: string,
  file: Buffer,
  n: number,
): Promise<void> {
  const auth = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };

  const sign = await fetch(`${coreUrl}/uploads`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      purpose: 'post-image',
      contentType: 'image/png',
      size: file.length,
      fileName: `memory-${n}.png`,
    }),
  });
  if (sign.status !== 201) throw new Error(`sign: ${await readError(sign)}`);
  const ticket = (await sign.json()) as UploadTicket;

  // Signed fields first, the file part last.
  const form = new FormData();
  for (const [k, v] of Object.entries(ticket.fields)) form.append(k, v);
  form.append('file', new Blob([new Uint8Array(file)]), `memory-${n}.png`);
  const stored = await fetch(ticket.url, { method: 'POST', body: form });
  if (stored.status >= 300)
    throw new Error(`storage: ${await readError(stored)}`);

  const confirm = await fetch(`${coreUrl}/uploads/${ticket.uploadId}/confirm`, {
    method: 'POST',
    headers: auth,
  });
  if (confirm.status !== 200) {
    throw new Error(`confirm: ${await readError(confirm)}`);
  }
}

async function main(): Promise<void> {
  const { uploads, coreUrl, authUrl } = parseArgs();
  const internalToken = process.env.INTERNAL_API_TOKEN;
  if (!internalToken) {
    throw new Error('INTERNAL_API_TOKEN is required to read core /metrics');
  }

  const token = await login(authUrl);
  const file = buildPng(FILE_BYTES);

  const startRss = await readRss(coreUrl, internalToken);
  let peakRss = startRss;
  let sampleError: unknown;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      await new Promise((r) => setTimeout(r, SAMPLE_INTERVAL_MS));
      try {
        peakRss = Math.max(peakRss, await readRss(coreUrl, internalToken));
      } catch (err) {
        sampleError = err;
        return;
      }
    }
  })();

  console.log(
    `Running ${uploads} concurrent ${FILE_BYTES / MiB} MiB uploads (start RSS ${(startRss / MiB).toFixed(1)} MiB)...`,
  );
  const results = await Promise.allSettled(
    Array.from({ length: uploads }, (_, i) =>
      uploadOne(coreUrl, token, file, i),
    ),
  );
  sampling = false;
  await sampler;
  try {
    peakRss = Math.max(peakRss, await readRss(coreUrl, internalToken));
  } catch (err) {
    sampleError ??= err;
  }

  const failures = results.filter(
    (r): r is PromiseRejectedResult => r.status === 'rejected',
  );
  for (const f of failures) {
    console.error(`upload failed: ${(f.reason as Error).message}`);
  }
  if (sampleError) {
    console.error(`metrics sampling failed: ${(sampleError as Error).message}`);
  }

  const deltaMiB = (peakRss - startRss) / MiB;
  const withinLimit = deltaMiB < LIMIT_MIB;
  console.log(
    `peak RSS delta: ${Math.round(deltaMiB)} MiB (< ${LIMIT_MIB} MiB) ${withinLimit ? '✓' : '✗'}`,
  );
  console.log(`confirmed: ${uploads - failures.length}/${uploads}`);
  if (!withinLimit || failures.length > 0 || sampleError) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
