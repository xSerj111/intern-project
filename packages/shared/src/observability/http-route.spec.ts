import { EventEmitter } from "events";
import type { RoutedRequest } from "./http-route";
import { isExcludedPath, routeLabel, trackRoute } from "./http-route";

const req = (props: Partial<RoutedRequest>) => props as RoutedRequest;

describe("http-route", () => {
  it.each(["/health", "/health/details", "/metrics?x=1"])(
    "excludes %s",
    (url) => {
      expect(isExcludedPath(req({ originalUrl: url }))).toBe(true);
    },
  );

  it("does not exclude other paths", () => {
    expect(isExcludedPath(req({ url: "/healthz" }))).toBe(false);
  });

  it('labels with baseUrl + route path, or "unmatched"', () => {
    expect(
      routeLabel(req({ baseUrl: "/users", route: { path: "/:id" } })),
    ).toBe("/users/:id");
    expect(routeLabel(req({}))).toBe("unmatched");
    expect(routeLabel(req({ route: { path: /x/ } }))).toBe("unmatched");
  });

  it("keeps the baseUrl seen when the route was assigned", () => {
    const r = req({ baseUrl: "/auth" });
    trackRoute(r);
    trackRoute(r); // idempotent
    r.route = { path: "/login" };
    r.baseUrl = "";
    expect(r.route).toEqual({ path: "/login" });
    expect(routeLabel(r)).toBe("/auth/login");
  });

  describe("unhandled 404 after a matched route called next()", () => {
    const run = (status: number, contentType?: string) => {
      const r = req({ baseUrl: "/users" });
      const res = new EventEmitter() as EventEmitter & {
        statusCode: number;
        getHeader: (name: string) => string | undefined;
      };
      res.statusCode = status;
      res.getHeader = (name) =>
        name.toLowerCase() === "content-type" ? contentType : undefined;
      trackRoute(r, res as never);
      r.route = { path: "/:id" };
      res.emit("finish");
      return r;
    };

    it("is labelled unmatched when the default (text/html) 404 is sent", () => {
      expect(routeLabel(run(404, "text/html; charset=utf-8"))).toBe(
        "unmatched",
      );
    });

    it("keeps the template for a handler's own 404 (JSON)", () => {
      expect(routeLabel(run(404, "application/json; charset=utf-8"))).toBe(
        "/users/:id",
      );
    });

    it("keeps the template for other statuses", () => {
      expect(routeLabel(run(200, "text/html"))).toBe("/users/:id");
    });
  });
});
