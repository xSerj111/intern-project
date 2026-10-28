import { expect, type Page } from '@playwright/test';
import { uniqueUser, type E2eUser } from './run-id';

const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:3002';
const CORE_URL = process.env.CORE_URL ?? 'http://localhost:3001';

/** A user registered through the auth API. `id` is the auth user id (JWT `sub`). */
export interface RegisteredUser extends E2eUser {
  id: string;
}

/** A registered user that also holds an access token and a core profile. */
export interface SetupUser extends RegisteredUser {
  accessToken: string;
  /** Core profile id (differs from `id`, the auth user id). */
  profileId: string;
}

async function request<T>(
  method: 'GET' | 'POST',
  url: string,
  options: { token?: string; body?: unknown; okStatuses?: number[] } = {},
): Promise<{ status: number; data: T }> {
  const res = await fetch(url, {
    method,
    headers: {
      ...(options.body === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  const ok = res.ok || options.okStatuses?.includes(res.status);
  if (!ok) {
    throw new Error(`${method} ${url} -> ${res.status} ${text}`);
  }
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}

/** POST AUTH_URL/users/register. */
export async function registerUser(user: E2eUser): Promise<RegisteredUser> {
  const { data } = await request<{ id: string }>(
    'POST',
    `${AUTH_URL}/users/register`,
    { body: { email: user.email, password: user.password } },
  );
  return { ...user, id: data.id };
}

/** POST AUTH_URL/auth/login; returns the access token (the refresh cookie is ignored). */
export async function loginViaApi(user: E2eUser): Promise<string> {
  const { data } = await request<{ accessToken: string }>(
    'POST',
    `${AUTH_URL}/auth/login`,
    { body: { email: user.email, password: user.password } },
  );
  return data.accessToken;
}

/**
 * GET CORE_URL/profiles/me, which lazily creates the profile when auth's
 * fire-and-forget `user-created` event has not landed yet. That event and the
 * lazy create can race on the unique `authUserId`, so a 409/5xx is retried.
 */
export async function ensureProfile(accessToken: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const { data } = await request<{ id: string }>(
        'GET',
        `${CORE_URL}/profiles/me`,
        { token: accessToken },
      );
      return data.id;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  throw lastError;
}

/** Register + log in + make sure the core profile exists. Fresh user per call. */
export async function createSetupUser(label: string): Promise<SetupUser> {
  const registered = await registerUser(uniqueUser(label));
  const accessToken = await loginViaApi(registered);
  const profileId = await ensureProfile(accessToken);
  return { ...registered, accessToken, profileId };
}

/** POST CORE_URL/follows: `follower` follows `target` (auth user ids). */
export async function followUser(
  follower: SetupUser,
  target: RegisteredUser,
): Promise<void> {
  await request('POST', `${CORE_URL}/follows`, {
    token: follower.accessToken,
    body: { followingId: target.id },
  });
}

/** POST CORE_URL/chats/direct (201 created, 200 existing); returns the conversation id. */
export async function createDirectChat(
  from: SetupUser,
  other: RegisteredUser,
): Promise<string> {
  const { data } = await request<{ id: string }>(
    'POST',
    `${CORE_URL}/chats/direct`,
    { token: from.accessToken, body: { userId: other.id } },
  );
  return data.id;
}

/** Signs in through the (auth)/login form and waits for the feed (`/`). */
export async function loginInBrowser(page: Page, user: E2eUser): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/');
}
