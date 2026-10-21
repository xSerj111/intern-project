import type { IncomingMessage, ServerResponse } from "http";
import { Counter, Histogram, Registry } from "prom-client";

const DURATION_NAME = "http_request_duration_seconds";
const ERRORS_NAME = "http_request_errors_total";
const LABELS = ["method", "route", "status_class"];
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const EXCLUDED_PATHS = new Set(["/health", "/health/details", "/metrics"]);

/** The subset of an Express request the middleware reads (kept structural so shared has no express dependency). */
type MetricsRequest = IncomingMessage & {
  baseUrl?: string;
  originalUrl?: string;
  route?: { path?: unknown };
};

function getOrCreateHistogram(registry: Registry): Histogram<string> {
  const existing = registry.getSingleMetric(DURATION_NAME);
  if (existing) return existing as Histogram<string>;
  return new Histogram({
    name: DURATION_NAME,
    help: "HTTP request duration in seconds",
    labelNames: LABELS,
    buckets: BUCKETS,
    registers: [registry],
  });
}

function getOrCreateCounter(registry: Registry): Counter<string> {
  const existing = registry.getSingleMetric(ERRORS_NAME);
  if (existing) return existing as Counter<string>;
  return new Counter({
    name: ERRORS_NAME,
    help: "HTTP responses with a 4xx or 5xx status",
    labelNames: LABELS,
    registers: [registry],
  });
}

/** `/posts/:id` from the matched Express route, never the raw URL (cardinality, leaked ids). */
function routeLabel(req: MetricsRequest): string {
  const path = req.route?.path;
  if (typeof path !== "string") return "unmatched";
  return `${req.baseUrl ?? ""}${path}`;
}

/**
 * Express-compatible middleware recording request duration and 4xx/5xx counts
 * on `registry`. Metrics are registered idempotently, so it can be created
 * more than once for the same registry. The route is read on `finish`, when the
 * router (Express or NestJS on Express) has set `req.route`.
 */
export function httpMetricsMiddleware(registry: Registry) {
  const duration = getOrCreateHistogram(registry);
  const errors = getOrCreateCounter(registry);

  return (req: MetricsRequest, res: ServerResponse, next: () => void): void => {
    const path = (req.originalUrl ?? req.url ?? "").split("?")[0];
    if (EXCLUDED_PATHS.has(path)) {
      next();
      return;
    }

    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const labels = {
        method: req.method ?? "UNKNOWN",
        route: routeLabel(req),
        status_class: `${Math.floor(res.statusCode / 100)}xx`,
      };
      duration.observe(labels, seconds);
      if (res.statusCode >= 400) errors.inc(labels);
    });
    next();
  };
}
