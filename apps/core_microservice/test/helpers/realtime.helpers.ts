/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- untyped JSON from auth */
import { io, type Socket } from 'socket.io-client';

export const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:3002';
export const TEST_PASSWORD = 'Strong@P4ssw0rd!';

export interface Session {
  email: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retries an idempotent setup step that can fail transiently (a DB or auth
 * hiccup right after an infra pause leaves the first calls erroring or stalled).
 * Use for suite setup only, never around the behaviour under test.
 */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  attempts = 5,
  delayMs = 500,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}

/** Thrown for 5xx / network failures so `retryTransient` can retry them. */
class TransientAuthError extends Error {}

async function postAuth(
  path: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; json: any }> {
  const res = await fetch(AUTH_URL + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
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

/** Logs an existing user in through auth (each call is a new session). */
export async function login(email: string): Promise<Session> {
  const res = await retryTransient(async () => {
    const r = await postAuth('/auth/login', {
      email,
      password: TEST_PASSWORD,
    });
    if (r.status >= 500) throw new TransientAuthError(`login ${r.status}`);
    return r;
  });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  const accessToken: string =
    res.json.accessToken ?? res.json.tokens?.accessToken;
  const refreshToken: string =
    res.json.refreshToken ?? res.json.tokens?.refreshToken;
  return { email, userId: subOf(accessToken), accessToken, refreshToken };
}

/**
 * Auth ids of every user `registerAndLogin` created in this test file (jest
 * gives each file its own module registry), for `cleanupE2eData`.
 */
export const registeredUserIds: string[] = [];

/** Registers a throwaway user through auth, then signs in. */
export async function registerAndLogin(label: string): Promise<Session> {
  const email = `e2e-${label}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
  // A 5xx may still have created the user; the retry reuses the same email and
  // treats the resulting 409 as "already registered" (login then proves it).
  const reg = await retryTransient(async () => {
    const r = await postAuth('/users/register', {
      email,
      password: TEST_PASSWORD,
    });
    if (r.status >= 500) throw new TransientAuthError(`register ${r.status}`);
    return r;
  });
  if (reg.status >= 300 && reg.status !== 409) {
    throw new Error(
      `register failed: ${reg.status} ${JSON.stringify(reg.json)}`,
    );
  }
  const session = await login(email);
  registeredUserIds.push(session.userId);
  return session;
}

/** Registers `count` users, at most `concurrency` at a time (auth hashes passwords). */
export async function registerMany(
  label: string,
  count: number,
  concurrency = 8,
): Promise<Session[]> {
  const sessions: Session[] = new Array(count);
  let next = 0;
  const worker = async () => {
    while (next < count) {
      const i = next++;
      sessions[i] = await registerAndLogin(`${label}${i}`);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, count) }, worker),
  );
  return sessions;
}

export async function logout(session: Session): Promise<number> {
  const res = await postAuth(
    '/auth/logout',
    { refreshToken: session.refreshToken },
    session.accessToken,
  );
  return res.status;
}

export interface TestSocket {
  socket: Socket;
  /** Every `message:new` payload received, in arrival order. */
  messages: any[];
  /** Every event received, as [name, payload]. */
  events: Array<[string, unknown]>;
}

export type ConnectResult =
  ({ ok: true } & TestSocket) | ({ ok: false; error: string } & TestSocket);

/** Opens a socket on `/realtime`; resolves on `connect` or `connect_error`. */
export function connectSocket(
  baseUrl: string,
  token?: string,
): Promise<ConnectResult> {
  return new Promise((resolve) => {
    const socket = io(`${baseUrl}/realtime`, {
      auth: token === undefined ? {} : { token },
      reconnection: false,
      transports: ['websocket'],
    });
    const ts: TestSocket = { socket, messages: [], events: [] };
    socket.onAny((name: string, payload: unknown) => {
      ts.events.push([name, payload]);
      if (name === 'message:new') ts.messages.push(payload);
    });
    const timer = setTimeout(
      () => resolve({ ok: false, error: 'timeout', ...ts }),
      5000,
    );
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve({ ok: true, ...ts });
    });
    socket.on('connect_error', (err: Error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message, ...ts });
    });
  });
}

/**
 * Blocks until the database answers a trivial query. Run first in `beforeAll`
 * so a stale or stalled pool connection surfaces here, not as dozens of
 * failing tests.
 */
export async function warmUpDb(db: {
  query: (sql: string) => Promise<unknown>;
}): Promise<void> {
  await retryTransient(() => db.query('SELECT 1'));
}

/** Polls `predicate` until it holds or `timeoutMs` passes. */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(25);
  }
  return predicate();
}

/** Payloads of every `name` event a socket received, in arrival order. */
export function eventsNamed(ts: TestSocket, name: string): any[] {
  return ts.events.filter(([n]) => n === name).map(([, payload]) => payload);
}
