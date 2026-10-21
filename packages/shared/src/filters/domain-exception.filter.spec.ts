import type { ArgumentsHost } from "@nestjs/common";

import { AccessDeniedError } from "../errors/access-denied.error";
import {
  DatabaseQueryError,
  EntityByIdNotFoundError,
  EntityNotFoundError,
  UnauthorizedError,
  UniqueConstraintViolationError,
} from "../errors/database.errors";
import type { DomainError } from "../errors/domain.error";
import { DomainExceptionFilter } from "./domain-exception.filter";

const setup = () => {
  const filter = new DomainExceptionFilter();
  const logger = { error: jest.fn(), warn: jest.fn() };
  (filter as unknown as { logger: typeof logger }).logger = logger;

  const json = jest.fn();
  const response = { status: jest.fn(), json };
  response.status.mockReturnValue(response);
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;

  return { filter, logger, response, json, host };
};

describe("DomainExceptionFilter", () => {
  it.each<[string, DomainError, number]>([
    ["EntityByIdNotFoundError", new EntityByIdNotFoundError("t", 1), 404],
    ["EntityNotFoundError", new EntityNotFoundError("t", {}), 404],
    ["AccessDeniedError", new AccessDeniedError(), 403],
    [
      "UniqueConstraintViolationError",
      new UniqueConstraintViolationError("t", "d"),
      409,
    ],
    ["DatabaseQueryError", new DatabaseQueryError(), 500],
    ["other domain errors", new UnauthorizedError(), 400],
  ])("maps %s to %i", (_name, error, status) => {
    const { filter, response, json, host } = setup();

    filter.catch(error, host);

    expect(response.status).toHaveBeenCalledWith(status);
    expect(json).toHaveBeenCalledWith({
      statusCode: status,
      error: error.name,
      message: error.message,
    });
  });

  it("logs 5xx as error and 4xx as warning", () => {
    const { filter, logger, host } = setup();

    filter.catch(new DatabaseQueryError(), host);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();

    filter.catch(new AccessDeniedError("no"), host);
    expect(logger.warn).toHaveBeenCalledWith(
      "Domain rule violation: AccessDeniedError",
      { props: { message: "no", status: 403 } },
    );
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
