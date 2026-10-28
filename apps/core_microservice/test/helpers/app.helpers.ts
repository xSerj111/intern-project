import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import {
  AllExceptionsFilter,
  WinstonLogger,
  accessLogMiddleware,
  createErrorsCounter,
  httpMetricsMiddleware,
  registerDbPoolGauge,
  requestIdMiddleware,
} from '@repo/shared';
import type { Registry } from 'prom-client';
import request from 'supertest';
import { DataSource } from 'typeorm';

interface PoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

export interface E2eApp {
  app: INestApplication;
  /** supertest handle bound to the app's ephemeral listener. */
  http: ReturnType<typeof request>;
  db: DataSource;
  /** Closes the app and restores every env var `createE2eApp` overrode. */
  close: () => Promise<void>;
}

/**
 * Boots the full `AppModule` like `src/main.ts` does for requests (global
 * `ValidationPipe` + `AllExceptionsFilter`, which maps domain errors and
 * counts every error response in `errors_total`), listening on an ephemeral port.
 *
 * `env` is applied to `process.env` BEFORE `AppModule` is imported, so config
 * read at import or construction time (e.g. `PERF_INSTRUMENTATION=true`, short
 * upload TTLs) sees it. Jest gives each spec file its own module registry, so
 * the late `require()` really re-evaluates the module per file.
 */
export async function createE2eApp(
  env: Record<string, string> = {},
  /** Hook to `overrideProvider(...)` before the module is compiled. */
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
): Promise<E2eApp> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  const restoreEnv = () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previous.clear();
  };

  try {
    // require(), not import(): under nodenext a dynamic import() needs a file
    // extension, and ts-jest compiles to CJS where require() is the same thing.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { AppModule } =
      require('../../src/app.module') as typeof import('../../src/app.module');
    /* eslint-enable @typescript-eslint/no-require-imports */
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { METRICS_REGISTRY } =
      require('../../src/common/observability/metrics.tokens') as typeof import('../../src/common/observability/metrics.tokens');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const moduleRef = await customize(
      Test.createTestingModule({ imports: [AppModule] }),
    ).compile();
    const app = moduleRef.createNestApplication();
    // main.ts wiring: the registry is created per app (MetricsModule factory),
    // so the non-idempotent pool gauge is registered exactly once here.
    const registry = app.get<Registry>(METRICS_REGISTRY);
    app.use(requestIdMiddleware());
    app.use(accessLogMiddleware(new WinstonLogger('Http')));
    app.use(httpMetricsMiddleware(registry));
    const db = app.get(DataSource);
    registerDbPoolGauge(registry, () => {
      const pool = (db.driver as { master?: PoolStats }).master;
      return (
        pool && {
          totalCount: pool.totalCount,
          idleCount: pool.idleCount,
          waitingCount: pool.waitingCount,
        }
      );
    });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(
      new AllExceptionsFilter(
        new BaseExceptionFilter(app.getHttpAdapter()),
        createErrorsCounter(registry),
      ),
    );
    await app.listen(0);
    return {
      app,
      http: request(app.getHttpServer() as Server),
      db,
      close: async () => {
        try {
          await app.close();
        } finally {
          restoreEnv();
        }
      },
    };
  } catch (err) {
    restoreEnv();
    throw err;
  }
}
