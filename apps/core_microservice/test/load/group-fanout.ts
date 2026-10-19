/**
 * Manual load spot-check for SC-005: group message fan-out latency.
 *
 * Registers N throwaway users through auth, creates one group chat, opens N
 * authenticated sockets on `/realtime`, sends M messages over HTTP from the
 * first member and measures, per recipient socket, the time from just before
 * the HTTP send to the arrival of the matching `message:new` event.
 *
 * Usage (needs core on :3001 and auth on :3002 running, plus their backing services):
 *   cd apps/core_microservice
 *   npx ts-node test/load/group-fanout.ts --members 100 --messages 50
 *
 * Options:
 *   --members <n>   group size incl. the sender, 3..100 (default 100)
 *   --messages <n>  messages to send (default 50)
 *   --core-url <u>  core base URL (default $CORE_URL or http://localhost:3001)
 *   --auth-url <u>  auth base URL (default $AUTH_URL or http://localhost:3002)
 *
 * Exits non-zero when p95 exceeds the 2 s target or deliveries are missing.
 */
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';

const P95_TARGET_MS = 2000;
const PASSWORD = 'Strong@P4ssw0rd!';
const SETUP_CONCURRENCY = 10;
const DRAIN_TIMEOUT_MS = 10000;

interface Member {
  userId: string;
  token: string;
  socket?: Socket;
}

interface JsonResult {
  status: number;
  json: Record<string, unknown>;
}

function parseArgs(): {
  members: number;
  messages: number;
  coreUrl: string;
  authUrl: string;
} {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const num = (name: string, fallback: number): number => {
    const raw = get(name);
    const n = raw === undefined ? fallback : Number(raw);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`--${name} must be a positive integer`);
    }
    return n;
  };
  const members = num('members', 100);
  if (members < 3 || members > 100) {
    throw new Error('--members must be between 3 and 100');
  }
  return {
    members,
    messages: num('messages', 50),
    coreUrl: get('core-url') ?? process.env.CORE_URL ?? 'http://localhost:3001',
    authUrl: get('auth-url') ?? process.env.AUTH_URL ?? 'http://localhost:3002',
  };
}

async function postJson(
  url: string,
  body: unknown,
  token?: string,
): Promise<JsonResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json };
}

const subOf = (token: string): string =>
  (
    JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    ) as { sub: string }
  ).sub;

async function registerAndLogin(authUrl: string, i: number): Promise<Member> {
  const email = `load-${i}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
  const reg = await postJson(`${authUrl}/users/register`, {
    email,
    password: PASSWORD,
  });
  if (reg.status >= 300) {
    throw new Error(
      `register failed: ${reg.status} ${JSON.stringify(reg.json)}`,
    );
  }
  const res = await postJson(`${authUrl}/auth/login`, {
    email,
    password: PASSWORD,
  });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  const tokens = (res.json.tokens ?? res.json) as { accessToken: string };
  return { userId: subOf(tokens.accessToken), token: tokens.accessToken };
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

function connect(coreUrl: string, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(`${coreUrl}/realtime`, {
      auth: { token },
      reconnection: false,
      transports: ['websocket'],
    });
    const timer = setTimeout(() => reject(new Error('connect timeout')), 10000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];

async function main(): Promise<void> {
  const { members, messages, coreUrl, authUrl } = parseArgs();
  console.log(
    `Fan-out load: ${members} members, ${messages} messages, core=${coreUrl}, auth=${authUrl}`,
  );

  console.log('Registering users...');
  const users = await mapLimit(
    Array.from({ length: members }),
    SETUP_CONCURRENCY,
    (_, i) => registerAndLogin(authUrl, i),
  );
  // Profiles are created lazily on first core call.
  await mapLimit(users, SETUP_CONCURRENCY, async (u) => {
    const res = await fetch(`${coreUrl}/profiles/me`, {
      headers: { authorization: `Bearer ${u.token}` },
    });
    if (res.status !== 200) {
      throw new Error(`profiles/me failed: ${res.status}`);
    }
  });

  const [sender, ...recipients] = users;
  const group = await postJson(
    `${coreUrl}/chats/groups`,
    { title: `load-${Date.now()}`, memberIds: recipients.map((r) => r.userId) },
    sender.token,
  );
  if (group.status !== 201) {
    throw new Error(
      `create group failed: ${group.status} ${JSON.stringify(group.json)}`,
    );
  }
  const chatId = group.json.id as string;

  // clientMessageId -> send start (ms, monotonic); per-recipient latencies.
  const sentAt = new Map<string, number>();
  const latencies: number[] = [];
  let delivered = 0;

  console.log('Opening sockets...');
  try {
    await mapLimit(recipients, SETUP_CONCURRENCY, async (r) => {
      r.socket = await connect(coreUrl, r.token);
      r.socket.on(
        'message:new',
        (payload: { message?: { clientMessageId?: string | null } }) => {
          const received = performance.now();
          const start = sentAt.get(payload.message?.clientMessageId ?? '');
          if (start === undefined) return;
          latencies.push(received - start);
          delivered++;
        },
      );
    });

    console.log('Sending messages...');
    for (let i = 0; i < messages; i++) {
      const clientMessageId = randomUUID();
      sentAt.set(clientMessageId, performance.now());
      const res = await postJson(
        `${coreUrl}/chats/${chatId}/messages`,
        { clientMessageId, content: `load message ${i + 1}` },
        sender.token,
      );
      if (res.status !== 201) {
        throw new Error(
          `send failed: ${res.status} ${JSON.stringify(res.json)}`,
        );
      }
    }

    const expected = messages * recipients.length;
    const deadline = Date.now() + DRAIN_TIMEOUT_MS;
    while (delivered < expected && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    console.log(`\nDeliveries: ${delivered}/${expected}`);
    if (sorted.length === 0) {
      console.log('No deliveries measured.');
      process.exitCode = 1;
      return;
    }
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    const max = sorted[sorted.length - 1];
    console.log(
      `Latency ms: p50=${p50.toFixed(1)} p95=${p95.toFixed(1)} max=${max.toFixed(1)}`,
    );
    const ok = p95 <= P95_TARGET_MS && delivered === expected;
    console.log(
      `SC-005 (p95 <= ${P95_TARGET_MS} ms, all delivered): ${ok ? 'PASS' : 'FAIL'}`,
    );
    if (!ok) process.exitCode = 1;
  } finally {
    recipients.forEach((r) => r.socket?.close());
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
