/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- OpenAPI document values are untyped */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, ModulesContainer } from '@nestjs/core';
import { SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { DomainExceptionFilter } from '@repo/shared';
import { AppModule } from './../src/app.module';
import { buildSwaggerConfig } from './../src/swagger';

jest.setTimeout(60000);

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface Operation {
  path: string;
  method: string;
  operationId: string;
  op: Record<string, any>;
}

describe('Notifications OpenAPI document (e2e)', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;
  let operations: Operation[];
  /** Guarded handlers, keyed like the default operationId (`Controller_method`). */
  let guarded: Set<string>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
    doc = SwaggerModule.createDocument(app, buildSwaggerConfig());
    operations = Object.entries(doc.paths).flatMap(([path, item]) =>
      METHODS.filter((m) => (item as any)[m]).map((method) => {
        const op = (item as any)[method];
        return { path, method, operationId: op.operationId as string, op };
      }),
    );
    guarded = new Set();
    const discovery = new DiscoveryService(app.get(ModulesContainer));
    for (const { instance, metatype } of discovery.getControllers()) {
      if (!metatype || !instance) continue;
      const classGuards = Reflect.getMetadata(GUARDS_METADATA, metatype) ?? [];
      const proto = Object.getPrototypeOf(instance);
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const methodGuards =
          Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
        if (classGuards.length + methodGuards.length > 0) {
          guarded.add(`${metatype.name}_${name}`);
        }
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const label = (o: Operation) => `${o.method.toUpperCase()} ${o.path}`;

  it('documents the notification and preference operations', () => {
    expect(operations.length).toBeGreaterThan(3);
  });

  it('gives every operation a summary', () => {
    expect(operations.filter((o) => !o.op.summary?.trim()).map(label)).toEqual(
      [],
    );
  });

  it('declares at least one 2xx response per operation', () => {
    expect(
      operations
        .filter(
          (o) => !Object.keys(o.op.responses ?? {}).some((c) => /^2/.test(c)),
        )
        .map(label),
    ).toEqual([]);
  });

  it('gives every 2xx response except 204 a non-empty schema', () => {
    const missing = operations.filter((o) =>
      Object.entries<any>(o.op.responses ?? {}).some(
        ([code, res]) =>
          /^2/.test(code) &&
          code !== '204' &&
          !Object.keys(res.content?.['application/json']?.schema ?? {}).length,
      ),
    );
    expect(missing.map(label)).toEqual([]);
  });

  it('marks every guarded route with security', () => {
    const guardedOps = operations.filter((o) => guarded.has(o.operationId));
    expect(guardedOps.length).toBeGreaterThan(0);
    expect(guardedOps.filter((o) => !o.op.security?.length).map(label)).toEqual(
      [],
    );
  });

  it('does not mark unguarded routes as secured', () => {
    expect(
      operations
        .filter((o) => !guarded.has(o.operationId) && o.op.security?.length)
        .map(label),
    ).toEqual([]);
  });

  it('omits health, metrics and internal endpoints', () => {
    const hidden = Object.keys(doc.paths).filter((p) =>
      /^\/(health|metrics|internal)(\/|$)/.test(p),
    );
    expect(hidden).toEqual([]);
  });
});
