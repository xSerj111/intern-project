import { getMetadataArgsStorage } from "typeorm";

import { TypeormEntityBase } from "./typeorm-entity.base";

class Sample extends TypeormEntityBase {}

describe("TypeormEntityBase", () => {
  it("declares the shared identity and audit columns", () => {
    const storage = getMetadataArgsStorage();
    const names = [...storage.generations, ...storage.columns]
      .filter((c) => c.target === TypeormEntityBase)
      .map((c) => c.propertyName)
      .sort();
    expect([...new Set(names)]).toEqual([
      "createdAt",
      "deletedAt",
      "id",
      "updatedAt",
    ]);
  });

  it("can be subclassed without extra setup", () => {
    expect(new Sample()).toBeInstanceOf(TypeormEntityBase);
  });
});
