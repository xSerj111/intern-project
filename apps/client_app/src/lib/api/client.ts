import { getAccessToken, refreshTokens } from '../auth/refresh';
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
  /** JSON-serialized, except `FormData`, which is sent as multipart as-is. */
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /** Cookie mode; `authApi` uses `'include'` so the refresh cookie travels. */
  credentials?: RequestCredentials;
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

async function send(
  baseUrl: string,
  path: string,
  options: ApiRequestOptions,
  token: string | null | undefined,
): Promise<Response> {
  const { method = 'GET', body, query, signal, credentials } = options;
  const isFormData =
    typeof FormData !== 'undefined' && body instanceof FormData;

  const headers: Record<string, string> = { Accept: 'application/json' };
  // FormData sets its own multipart Content-Type (with boundary).
  if (body !== undefined && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    return await fetch(buildUrl(baseUrl, path, query), {
      method,
      headers,
      body:
        body === undefined
          ? undefined
          : isFormData
            ? body
            : JSON.stringify(body),
      signal,
      credentials,
      cache: 'no-store',
    });
  } catch (cause) {
    // Network failure (service down, DNS, CORS) — status 0 signals "unreachable"
    // so the retry UI can treat it the same as a 5xx.
    throw new ApiError('Unable to reach the service', 0, cause);
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const payload = await parseBody(response);
  return new ApiError(
    errorMessage(payload) ?? `Request failed with status ${response.status}`,
    response.status,
    payload,
  );
}

/**
 * Token to retry a 401 with: the current one when another request already
 * refreshed past the token we sent, otherwise a freshly refreshed one.
 */
async function retryToken(sentToken: string): Promise<string | null> {
  const current = getAccessToken();
  if (current && current !== sentToken) {
    return current;
  }
  try {
    return await refreshTokens();
  } catch {
    return null;
  }
}

/**
 * Typed `fetch` wrapper. Attaches the caller's JWT and parses JSON, throwing an
 * {@link ApiError} on any non-2xx status or network failure so UI error states can
 * render uniformly. A 401 on a request that carried a token triggers one token
 * refresh and a single retry with the new token.
 */
export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { token } = options;

  let response = await send(baseUrl, path, options, token);
  if (response.status === 401 && token) {
    const nextToken = await retryToken(token);
    if (!nextToken) {
      throw await toApiError(response);
    }
    response = await send(baseUrl, path, options, nextToken);
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  return (await parseBody(response)) as T;
}

/** Request against the core service (`CORE_SERVICE_URL`). */
export function coreApi<T>(
  path: string,
  options?: ApiRequestOptions,
): Promise<T> {
  return apiRequest<T>(config.coreServiceUrl, path, options);
}

export interface UploadOptions {
  token?: string | null;
  signal?: AbortSignal;
  /** Upload progress as a 0..1 fraction. Switches the request to XMLHttpRequest. */
  onProgress?: (fraction: number) => void;
}

/**
 * Request against the auth service (`AUTH_SERVICE_URL`). Sends cookies so the
 * httpOnly `refresh_token` cookie reaches `/auth/refresh` and `/auth/logout`.
 */
export function authApi<T>(
  path: string,
  options?: ApiRequestOptions,
): Promise<T> {
  return apiRequest<T>(config.authServiceUrl, path, {
    credentials: 'include',
    ...options,
  });
}

/** Request against the notifications service (`NOTIFICATIONS_SERVICE_URL`). */
export function notificationsRequest<T>(
  path: string,
  options?: ApiRequestOptions,
): Promise<T> {
  return apiRequest<T>(config.notificationsServiceUrl, path, options);
}
