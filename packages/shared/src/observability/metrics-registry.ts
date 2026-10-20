import { collectDefaultMetrics, Registry } from 'prom-client';

/**
 * Builds an isolated prom-client registry for one service: every series carries
 * a `service` default label and the Node default metrics (including
 * `process_resident_memory_bytes`) are registered on it.
 */
export function createMetricsRegistry(service: string): Registry {
  const register = new Registry();
  register.setDefaultLabels({ service });
  collectDefaultMetrics({ register });
  return register;
}
