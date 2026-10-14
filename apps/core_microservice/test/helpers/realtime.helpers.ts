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
  const res = await postAuth('/auth/login', {
    email,
    password: TEST_PASSWORD,
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

/** Registers a throwaway user through auth, then signs in. */
export async function registerAndLogin(label: string): Promise<Session> {
  const email = `e2e-${label}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
  const reg = await postAuth('/users/register', {
    email,
    password: TEST_PASSWORD,
  });
  if (reg.status >= 300) {
    throw new Error(
      `register failed: ${reg.status} ${JSON.stringify(reg.json)}`,
    );
  }
  return login(email);
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
