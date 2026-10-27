// env.ts fails fast on these at import time, so set them before anything loads it.
process.env.CORE_SERVICE_URL = 'http://localhost:3001';
process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.INTERNAL_API_TOKEN = 'x'.repeat(32);

import type { Application } from 'express';
import type { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import type { WinstonLogger } from '@repo/shared';
import { createApp } from '../app';
import type { RedisService } from '../infrastructure/cache/redis.service';
import { REFRESH_COOKIE } from '../routes/auth.routes';
import {
  buildOpenApiDocument,
  HTTP_METHODS,
  REFRESH_COOKIE_NAME,
  type HttpMethod,
  type OpenApiDocument,
} from './openapi';
import { OPENAPI_JSON_PATH, SWAGGER_UI_PATH } from './swagger';

/** Public-app routes that require `X-Internal-Token` and stay out of the document. */
const INTERNAL_ONLY = ['GET /health/details', 'GET /metrics'];
/** Swagger's own routes. */
const DOC_ROUTES = [`GET ${OPENAPI_JSON_PATH}`];

interface Layer {
  name: string;
  regexp: RegExp;
  route?: { path: string; methods: Record<string, boolean> };
  handle: { stack?: Layer[] };
}

/** Turns Express 4's mount regexp (e.g. `^\/auth\/?(?=\/|$)`) back into `/auth`. */
const mountPrefix = (regexp: RegExp): string =>
  regexp.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\\\//g, '/');

/** Every `METHOD /path` registered on the app's routers, mounts included. */
function registeredRoutes(stack: Layer[], prefix = ''): string[] {
  return stack.flatMap((layer) => {
    if (layer.route) {
      return Object.keys(layer.route.methods)
        .filter((method) => (HTTP_METHODS as readonly string[]).includes(method))
        .map((method) => `${method.toUpperCase()} ${prefix}${layer.route!.path}`);
    }
    if (layer.name === 'router' && layer.handle.stack) {
      return registeredRoutes(layer.handle.stack, prefix + mountPrefix(layer.regexp));
    }
    return [];
  });
}

function documentedRoutes(doc: OpenApiDocument): string[] {
  return Object.entries(doc.paths).flatMap(([path, item]) =>
    (Object.keys(item) as HttpMethod[]).map(
      (method) => `${method.toUpperCase()} ${path}`,
    ),
  );
}

describe('OpenAPI document', () => {
  let app: Application;
  const doc = buildOpenApiDocument('http://auth.test:3002');

  beforeAll(() => {
    app = createApp(
      { getRepository: jest.fn() } as unknown as DataSource,
      {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as WinstonLogger,
      {} as unknown as RedisService,
      { publish: jest.fn() } as unknown as Redis,
    );
  });

  const appRoutes = (): string[] =>
    registeredRoutes((app as unknown as { _router: { stack: Layer[] } })._router.stack);

  it('finds the public routers by introspection', () => {
    expect(appRoutes()).toEqual(
      expect.arrayContaining(['POST /auth/login', 'POST /users/register', 'GET /health']),
    );
  });

  it('documents every public route registered on the app', () => {
    const publicRoutes = appRoutes().filter(
      (route) => !INTERNAL_ONLY.includes(route) && !DOC_ROUTES.includes(route),
    );

    expect(documentedRoutes(doc).sort()).toEqual([...new Set(publicRoutes)].sort());
  });

  it('keeps the internal-only routes out of the document', () => {
    // Guards against a stale list: these routes really exist on the public app.
    expect(appRoutes()).toEqual(expect.arrayContaining(INTERNAL_ONLY));
    for (const route of INTERNAL_ONLY) {
      expect(documentedRoutes(doc)).not.toContain(route);
    }
    expect(Object.keys(doc.paths).some((path) => path.startsWith('/internal'))).toBe(
      false,
    );
  });

  it('serves the document from the configured public URL', () => {
    expect(doc.servers).toEqual([{ url: 'http://auth.test:3002' }]);
  });

  it('declares the bearer and refresh-cookie security schemes', () => {
    expect(REFRESH_COOKIE_NAME).toBe(REFRESH_COOKIE);
    expect(doc.components.securitySchemes).toMatchObject({
      bearerAuth: { type: 'http', scheme: 'bearer' },
      refreshCookie: { type: 'apiKey', in: 'cookie', name: REFRESH_COOKIE },
    });
  });

  it('never puts the refresh token in a response body', () => {
    const session = doc.components.schemas.SessionResponse;

    expect(Object.keys(session.properties ?? {})).toEqual(['accessToken', 'user']);
  });

  it('only references components that exist', () => {
    const refs = JSON.stringify(doc).match(/#\/components\/[a-zA-Z]+\/[a-zA-Z]+/g) ?? [];

    for (const target of new Set(refs)) {
      const [, , group, name] = target.split('/');
      const components = doc.components as unknown as Record<
        string,
        Record<string, unknown>
      >;
      expect(components[group]?.[name]).toBeDefined();
    }
  });

  it('keeps the UI and JSON paths stable', () => {
    expect([SWAGGER_UI_PATH, OPENAPI_JSON_PATH]).toEqual(['/api', '/api-json']);
  });
});
