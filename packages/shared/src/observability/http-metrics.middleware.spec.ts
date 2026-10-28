import express from "express";
import request from "supertest";
import { createMetricsRegistry } from "./metrics-registry";
import { httpMetricsMiddleware } from "./http-metrics.middleware";

function buildApp(registry = createMetricsRegistry("test")) {
  const app = express();
  app.use(httpMetricsMiddleware(registry));
  app.get("/posts/:id", (req, res) => {
    if (req.params.id === "missing") {
      res.status(404).json({ message: "nope" });
      return;
    }
    res.json({ id: req.params.id });
  });
  const router = express.Router();
  router.get("/:id", (_req, res) => res.json({}));
  app.use("/users", router);
  app.get("/health", (_req, res) => res.json({ status: "healthy" }));
  app.get("/health/details", (_req, res) => res.json({}));
  app.get("/metrics", (_req, res) => res.send(""));
  return { app, registry };
}

describe("httpMetricsMiddleware", () => {
  it("labels with the route template and 2xx status class", async () => {
    const { app, registry } = buildApp();
    await request(app).get("/posts/123").expect(200);

    const text = await registry.metrics();
    expect(text).toMatch(
      /http_request_duration_seconds_count\{[^}]*method="GET"[^}]*route="\/posts\/:id"[^}]*status_class="2xx"[^}]*\} 1/,
    );
    expect(text).not.toContain("/posts/123");
    expect(text).not.toMatch(/http_request_errors_total\{/);
  });

  it("counts 4xx responses in the duration histogram and the error counter", async () => {
    const { app, registry } = buildApp();
    await request(app).get("/posts/missing").expect(404);

    const text = await registry.metrics();
    expect(text).toMatch(
      /http_request_errors_total\{[^}]*route="\/posts\/:id"[^}]*status_class="4xx"[^}]*\} 1/,
    );
    expect(text).toMatch(
      /http_request_duration_seconds_count\{[^}]*status_class="4xx"[^}]*\} 1/,
    );
  });

  it("includes the router mount path in the label", async () => {
    const { app, registry } = buildApp();
    await request(app).get("/users/42").expect(200);

    expect(await registry.metrics()).toMatch(/route="\/users\/:id"/);
  });

  it("keeps the router mount path when an app-level error handler responds", async () => {
    const registry = createMetricsRegistry("test");
    const app = express();
    app.use(httpMetricsMiddleware(registry));
    const router = express.Router();
    router.post("/login", (_req, _res, next) => next(new Error("bad")));
    app.use("/auth", router);
    app.use(
      (
        _err: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(401).json({});
      },
    );

    await request(app).post("/auth/login").expect(401);

    const text = await registry.metrics();
    expect(text).toMatch(
      /http_request_errors_total\{[^}]*route="\/auth\/login"[^}]*status_class="4xx"[^}]*\} 1/,
    );
  });

  it('uses "unmatched" when no route handled the request', async () => {
    const { app, registry } = buildApp();
    await request(app).get("/nothing/secret-id").expect(404);

    const text = await registry.metrics();
    expect(text).toMatch(/route="unmatched"[^}]*status_class="4xx"/);
    expect(text).not.toContain("secret-id");
  });

  it("excludes /health, /health/details and /metrics", async () => {
    const { app, registry } = buildApp();
    await request(app).get("/health").expect(200);
    await request(app).get("/health/details").expect(200);
    await request(app).get("/metrics?x=1").expect(200);

    const text = await registry.metrics();
    expect(text).not.toMatch(/http_request_duration_seconds_count\{/);
  });

  it("can be created twice on one registry without throwing", () => {
    const registry = createMetricsRegistry("test");
    expect(() => {
      httpMetricsMiddleware(registry);
      httpMetricsMiddleware(registry);
    }).not.toThrow();
  });
});
