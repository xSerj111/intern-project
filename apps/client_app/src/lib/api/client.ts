import { config } from '../config';

/** Error thrown for any non-2xx response or network failure. */
export class ApiError extends Error {
  /** HTTP status, or `0` when the request never reached the service. */
  readonly status: number;
  /** Parsed response body, when any. */
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JWT attached as `Authorization: Bearer <token>`. */
  token?: string | null;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: ApiRequestOptions['query'],
): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
    if (Array.isArray(message)) {
      return message.join(', ');
    }
  }
  return undefined;
}

/**
 * Typed `fetch` wrapper. Attaches the caller's JWT and parses JSON, throwing an
 * {@link ApiError} on any non-2xx status or network failure so UI error states can
 * render uniformly.
 */
export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { method = 'GET', token, body, query, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(baseUrl, path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: 'no-store',
    });
  } catch (cause) {
    // Network failure (service down, DNS, CORS) — status 0 signals "unreachable"
    // so the retry UI can treat it the same as a 5xx.
    throw new ApiError('Unable to reach the service', 0, cause);
  }

  const payload = await parseBody(response);
  if (!response.ok) {
    throw new ApiError(
      errorMessage(payload) ?? `Request failed with status ${response.status}`,
      response.status,
      payload,
    );
  }

  return payload as T;
}

/** Request against the core service (`CORE_SERVICE_URL`). */
export function coreApi<T>(
  path: string,
  options?: ApiRequestOptions,
): Promise<T> {
  return apiRequest<T>(config.coreServiceUrl, path, options);
}

/** Request against the auth service (`AUTH_SERVICE_URL`). */
export function authApi<T>(
  path: string,
  options?: ApiRequestOptions,
): Promise<T> {
  return apiRequest<T>(config.authServiceUrl, path, options);
}

/** Request against the notifications service (`NOTIFICATIONS_SERVICE_URL`). */
export function notificationsRequest<T>(
  path: string,
  options?: ApiRequestOptions,
): Promise<T> {
  return apiRequest<T>(config.notificationsServiceUrl, path, options);
}
