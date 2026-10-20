import { Counter } from 'prom-client';
import { createMetricsRegistry } from './metrics-registry';

describe('createMetricsRegistry', () => {
  it('does not share series between two registries', async () => {
    const a = createMetricsRegistry('svc-a');
    const b = createMetricsRegistry('svc-b');
    const counter = new Counter({
      name: 'sample_total',
      help: 'sample',
      registers: [a],
    });
    counter.inc();

    expect(await a.getSingleMetricAsString('sample_total')).toContain(
      'sample_total',
    );
    expect(b.getSingleMetric('sample_total')).toBeUndefined();
    expect(await b.metrics()).not.toContain('sample_total');
  });

  it('adds the service label to a sample counter', async () => {
    const registry = createMetricsRegistry('core');
    new Counter({
      name: 'labelled_total',
      help: 'sample',
      registers: [registry],
    }).inc();

    expect(await registry.getSingleMetricAsString('labelled_total')).toContain(
      'labelled_total{service="core"} 1',
    );
  });

  it('registers process_resident_memory_bytes', async () => {
    const registry = createMetricsRegistry('core');
    expect(await registry.metrics()).toContain('process_resident_memory_bytes');
  });
});
