import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Registry } from 'prom-client';
import { lastValueFrom, of } from 'rxjs';
import { AppConfigService } from '../../config/app-config.service';
import { incrementQueryCount, runWithQueryContext } from '../db/query-context';
import { QueryCountInterceptor } from './query-count.interceptor';

describe('QueryCountInterceptor', () => {
  const build = (enabled: boolean, registry = new Registry()) => {
    const res = { headersSent: false, setHeader: jest.fn() };
    const req = { baseUrl: '', route: { path: '/posts/:id' } };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
    } as unknown as ExecutionContext;
    const config = { perfInstrumentation: enabled } as AppConfigService;
    return {
      res,
      req,
      context,
      registry,
      interceptor: new QueryCountInterceptor(config, registry),
    };
  };
  const handler: CallHandler = {
    handle: () => {
      incrementQueryCount();
      incrementQueryCount();
      incrementQueryCount();
      return of('ok');
    },
  };

  it('sets X-Db-Query-Count to the integer count when enabled', async () => {
    const { res, context, interceptor } = build(true);

    await runWithQueryContext(() =>
      lastValueFrom(interceptor.intercept(context, handler)),
    );

    expect(res.setHeader).toHaveBeenCalledWith('X-Db-Query-Count', '3');
  });

  it('does not set the header when disabled', async () => {
    const { res, context, interceptor } = build(false);

    await runWithQueryContext(() =>
      lastValueFrom(interceptor.intercept(context, handler)),
    );

    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('observes db_queries_per_request with the route template even when the header is disabled', async () => {
    const { context, interceptor, registry } = build(false);

    await runWithQueryContext(() =>
      lastValueFrom(interceptor.intercept(context, handler)),
    );

    const metrics = await registry.metrics();
    expect(metrics).toContain(
      'db_queries_per_request_count{route="/posts/:id"} 1',
    );
    expect(metrics).toContain(
      'db_queries_per_request_sum{route="/posts/:id"} 3',
    );
  });

  it('labels requests without a matched route as "unmatched"', async () => {
    const { req, context, interceptor, registry } = build(false);
    delete (req as { route?: unknown }).route;

    await runWithQueryContext(() =>
      lastValueFrom(interceptor.intercept(context, handler)),
    );

    expect(await registry.metrics()).toContain('route="unmatched"');
  });

  it('shares one histogram when created twice on the same registry', async () => {
    const first = build(false);
    const second = build(false, first.registry);

    await runWithQueryContext(() =>
      lastValueFrom(second.interceptor.intercept(second.context, handler)),
    );

    expect(await first.registry.metrics()).toContain(
      'db_queries_per_request_count{route="/posts/:id"} 1',
    );
  });

  it('skips non-http contexts', async () => {
    const { interceptor, registry } = build(true);
    const wsContext = { getType: () => 'ws' } as unknown as ExecutionContext;

    await lastValueFrom(interceptor.intercept(wsContext, handler));

    expect(await registry.metrics()).not.toContain('db_queries_per_request_');
  });
});
