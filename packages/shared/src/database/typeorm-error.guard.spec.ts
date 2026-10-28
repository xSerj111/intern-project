import { QueryFailedError } from "typeorm";

import { PostgresErrorCode } from "./postgres-error-code.enum";
import { isTypeOrmError } from "./typeorm-error.guard";

describe("isTypeOrmError", () => {
  it("accepts a QueryFailedError and exposes the driver code", () => {
    const err: unknown = new QueryFailedError("SELECT 1", [], {
      code: PostgresErrorCode.NotNullViolation,
    } as unknown as Error);
    expect(isTypeOrmError(err)).toBe(true);
    if (isTypeOrmError(err)) {
      expect(err.driverError.code).toBe("23502");
    }
  });

  it.each([new Error("x"), null, undefined, "str", { driverError: {} }])(
    "rejects %p",
    (value) => {
      expect(isTypeOrmError(value)).toBe(false);
    },
  );

  it("keeps the SQLSTATE values we map", () => {
    expect(PostgresErrorCode.UniqueViolation).toBe("23505");
    expect(PostgresErrorCode.ForeignKeyViolation).toBe("23503");
    expect(PostgresErrorCode.CheckViolation).toBe("23514");
  });
});
