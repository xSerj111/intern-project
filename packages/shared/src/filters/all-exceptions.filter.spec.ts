import {
  BadRequestException,
  HttpException,
  NotFoundException,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";

import { AccessDeniedError } from "../errors/access-denied.error";
import { AllExceptionsFilter } from "./all-exceptions.filter";

const setup = (request: { route?: unknown } = { route: { path: "/x" } }) => {
  const counter = { inc: jest.fn() };
  const fallback: ExceptionFilter & { catch: jest.Mock } = { catch: jest.fn() };
  const filter = new AllExceptionsFilter(fallback, counter);
  (filter as unknown as { domain: { logger: unknown } }).domain.logger = {
    error: jest.fn(),
    warn: jest.fn(),
  };
  const json = jest.fn();
  const response = { status: jest.fn(), json };
  response.status.mockReturnValue(response);
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { filter, counter, fallback, response, json, host };
};

describe("AllExceptionsFilter", () => {
  it("maps domain errors like DomainExceptionFilter and counts them once", () => {
    const { filter, counter, fallback, response, host } = setup();

    filter.catch(new AccessDeniedError(), host);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(fallback.catch).not.toHaveBeenCalled();
    expect(counter.inc.mock.calls).toEqual([
      [{ source: "http", type: "AccessDeniedError" }],
    ]);
  });

  it("counts unhandled errors and HTTP exceptions, then delegates the response", () => {
    const { filter, counter, fallback, response, host } = setup();
    const boom = new TypeError("boom");
    const bad = new BadRequestException();

    filter.catch(boom, host);
    filter.catch(bad, host);

    expect(fallback.catch.mock.calls).toEqual([
      [boom, host],
      [bad, host],
    ]);
    expect(response.status).not.toHaveBeenCalled();
    expect(counter.inc.mock.calls).toEqual([
      [{ source: "http", type: "TypeError" }],
      [{ source: "http", type: "BadRequestException" }],
    ]);
  });

  it("does not count HTTP exceptions with a non-error status", () => {
    const { filter, counter, fallback, host } = setup();
    const redirect = new HttpException("moved", 302);

    filter.catch(redirect, host);

    expect(fallback.catch).toHaveBeenCalledWith(redirect, host);
    expect(counter.inc).not.toHaveBeenCalled();
  });

  it("does not count the NotFoundException of an unmatched route, but still delegates it", () => {
    const { filter, counter, fallback, host } = setup({});
    const notFound = new NotFoundException("Cannot GET /nope");

    filter.catch(notFound, host);

    expect(fallback.catch).toHaveBeenCalledWith(notFound, host);
    expect(counter.inc).not.toHaveBeenCalled();
  });

  it("counts a NotFoundException thrown by a matched route's handler", () => {
    const { filter, counter, fallback, host } = setup({
      route: { path: "/posts/:id" },
    });
    const notFound = new NotFoundException("no such post");

    filter.catch(notFound, host);

    expect(fallback.catch).toHaveBeenCalledWith(notFound, host);
    expect(counter.inc.mock.calls).toEqual([
      [{ source: "http", type: "NotFoundException" }],
    ]);
  });
});
