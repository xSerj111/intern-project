import type { IncomingMessage, ServerResponse } from "http";

/** Paths neither the access log nor the HTTP metrics record. */
export const EXCLUDED_PATHS: ReadonlySet<string> = new Set([
  "/health",
  "/health/details",
  "/metrics",
]);

/** The subset of an Express request the HTTP middlewares read (no express dependency). */
export type RoutedRequest = IncomingMessage & {
  baseUrl?: string;
  originalUrl?: string;
  route?: { path?: unknown };
};

const CAPTURED = Symbol("routeLabel");
const UNMATCHED = Symbol("routeUnmatched");
type Tracked = RoutedRequest & { [CAPTURED]?: string; [UNMATCHED]?: boolean };

/** True for `/health`, `/health/details` and `/metrics` (query string ignored). */
export function isExcludedPath(req: RoutedRequest): boolean {
  return EXCLUDED_PATHS.has((req.originalUrl ?? req.url ?? "").split("?")[0]);
}

/**
 * Captures the route label at the moment Express assigns `req.route`, while
 * `req.baseUrl` still holds the router mount path. On the error path Express
 * restores `baseUrl` before the app-level error handler responds, so reading
 * it on `finish` would turn `/auth/login` into `/login`. Idempotent per request.
 *
 * Pass `res` so a route whose handlers all called `next()` is not labelled
 * with its template: Express then answers with its default 404 page
 * (`text/html`), which is recorded as `unmatched`. Call it before registering
 * your own `finish` listener, so this one runs first.
 */
export function trackRoute(req: RoutedRequest, res?: ServerResponse): void {
  const tracked = req as Tracked;
  if (Object.prototype.hasOwnProperty.call(tracked, CAPTURED)) return;
  tracked[CAPTURED] = undefined;
  res?.on("finish", () => {
    const contentType = res.getHeader("content-type");
    if (
      res.statusCode === 404 &&
      typeof contentType === "string" &&
      contentType.startsWith("text/html")
    ) {
      tracked[CAPTURED] = undefined;
      tracked[UNMATCHED] = true;
    }
  });
  let route = tracked.route;
  Object.defineProperty(tracked, "route", {
    configurable: true,
    enumerable: true,
    get: () => route,
    set: (value: RoutedRequest["route"]) => {
      route = value;
      const path = value?.path;
      tracked[CAPTURED] =
        typeof path === "string"
          ? `${tracked.baseUrl ?? ""}${path}`
          : undefined;
    },
  });
}

/**
 * `/posts/:id` from the matched Express route, never the raw URL (cardinality,
 * leaked ids); `unmatched` when no route handled the request.
 */
export function routeLabel(req: RoutedRequest): string {
  if ((req as Tracked)[UNMATCHED]) return "unmatched";
  const captured = (req as Tracked)[CAPTURED];
  if (captured) return captured;
  const path = req.route?.path;
  if (typeof path !== "string") return "unmatched";
  return `${req.baseUrl ?? ""}${path}`;
}
