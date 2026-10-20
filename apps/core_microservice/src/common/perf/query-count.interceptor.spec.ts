import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { AppConfigService } from '../../config/app-config.service';
import { incrementQueryCount, runWithQueryContext } from '../db/query-context';
import { QueryCountInterceptor } from './query-count.interceptor';

describe('QueryCountInterceptor', () => {
  const build = (enabled: boolean) => {
    const res = { headersSent: false, setHeader: jest.fn() };
    const context = {
      switchToHttp: () => ({ getResponse: () => res }),
    } as unknown as ExecutionContext;
    const config = { perfInstrumentation: enabled } as AppConfigService;
    return { res, context, interceptor: new QueryCountInterceptor(config) };
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
});
