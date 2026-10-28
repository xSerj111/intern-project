import { Registry } from 'prom-client';
import { DomainError } from '../errors/domain.error';
import { createErrorsCounter, errorType, recordError } from './error-metrics';

class SampleDomainError extends DomainError {
  constructor() {
    super('sample');
  }
}

describe('error metrics', () => {
  it('registers errors_total once per registry (get-or-create)', async () => {
    const registry = new Registry();
    const first = createErrorsCounter(registry);
    const second = createErrorsCounter(registry);

    expect(second).toBe(first);
    recordError(first, 'http', new SampleDomainError());
    recordError(second, 'amqp', new TypeError('x'));

    const text = await registry.metrics();
    expect(text).toContain(
      'errors_total{source="http",type="SampleDomainError"} 1',
    );
    expect(text).toContain('errors_total{source="amqp",type="TypeError"} 1');
  });

  it('labels by class name only, never the message', () => {
    expect(errorType(new RangeError('user 123 secret'))).toBe('RangeError');
    expect(errorType('boom')).toBe('NonError');
    expect(errorType(undefined)).toBe('NonError');

    const anonymous = new Error('x');
    Object.defineProperty(anonymous, 'constructor', {
      value: { name: 'bad name!' },
    });
    expect(errorType(anonymous)).toBe('Error');
  });

  it('is a no-op without a counter', () => {
    expect(() => recordError(undefined, 'http', new Error('x'))).not.toThrow();
  });
});
