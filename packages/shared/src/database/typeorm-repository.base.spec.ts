import { QueryFailedError } from "typeorm";
import type { Repository } from "typeorm";

import {
  DatabaseQueryError,
  EntityByIdNotFoundError,
  EntityNotFoundError,
  UniqueConstraintViolationError,
} from "../errors/database.errors";
import type { Logger } from "../logger";
import { PostgresErrorCode } from "./postgres-error-code.enum";
import { TypeormRepositoryBase } from "./typeorm-repository.base";

interface Thing {
  id: string;
  name: string;
}

class ThingRepository extends TypeormRepositoryBase<Thing, Partial<Thing>> {
  protected relations: string[] = [];

  constructor(repo: Repository<Thing>, logger?: Logger) {
    super(repo, logger);
  }

  public exposeTableName() {
    return this.tableName;
  }

  public exposeRelations(relations?: string[]) {
    return this.resolveRelations(relations);
  }

  public setDefaultRelations(relations: string[]) {
    this.relations = relations;
  }
}

const makeMocks = () => {
  const repo = {
    metadata: { tableName: "things" },
    remove: jest.fn(),
    delete: jest.fn(),
    softRemove: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn(),
  };
  const logger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    fatal: jest.fn(),
  };
  const sut = new ThingRepository(
    repo as unknown as Repository<Thing>,
    logger as unknown as Logger,
  );
  return { repo, logger, sut };
};

const thing = { id: "id-1", name: "a" } as Thing;

describe("TypeormRepositoryBase", () => {
  it("falls back to a default WinstonLogger when none is injected", () => {
    const { repo } = makeMocks();
    const sut = new ThingRepository(repo as unknown as Repository<Thing>);
    expect(sut.exposeTableName()).toBe("things");
  });

  describe("resolveRelations", () => {
    it("returns undefined for an empty list", () => {
      const { sut } = makeMocks();
      expect(sut.exposeRelations()).toBeUndefined();
      expect(sut.exposeRelations([])).toBeUndefined();
    });

    it("uses the default relations when none are passed", () => {
      const { sut } = makeMocks();
      sut.setDefaultRelations(["author"]);
      expect(sut.exposeRelations()).toEqual({ author: true });
    });

    it("turns dotted paths into nested objects", () => {
      const { sut } = makeMocks();
      expect(sut.exposeRelations(["author", "comments.author"])).toEqual({
        author: true,
        comments: { author: true },
      });
    });

    it("upgrades a leaf listed before its nested path", () => {
      const { sut } = makeMocks();
      expect(sut.exposeRelations(["a", "a.b"])).toEqual({ a: { b: true } });
    });

    it("keeps an existing node when the parent is listed after its child", () => {
      const { sut } = makeMocks();
      expect(sut.exposeRelations(["a.b", "a"])).toEqual({ a: { b: true } });
    });
  });

  describe("delete family", () => {
    it("delete removes the entity and returns it", async () => {
      const { repo, sut } = makeMocks();
      await expect(sut.delete(thing)).resolves.toBe(thing);
      expect(repo.remove).toHaveBeenCalledWith(thing);
    });

    it("deleteMultiple removes all entities", async () => {
      const { repo, sut } = makeMocks();
      await expect(sut.deleteMultiple([thing])).resolves.toEqual([thing]);
      expect(repo.remove).toHaveBeenCalledWith([thing]);
    });

    it("deleteByCriteria returns the affected row count", async () => {
      const { repo, sut } = makeMocks();
      repo.delete.mockResolvedValue({ affected: 3 });
      await expect(sut.deleteByCriteria({ name: "a" })).resolves.toBe(3);
      expect(repo.delete).toHaveBeenCalledWith({ name: "a" });
    });

    it("deleteByCriteria defaults to 0 when affected is undefined", async () => {
      const { repo, sut } = makeMocks();
      repo.delete.mockResolvedValue({});
      await expect(sut.deleteByCriteria({ name: "a" })).resolves.toBe(0);
    });

    it("deleteByCriteria refuses to run without criteria", async () => {
      const { repo, sut } = makeMocks();
      await expect(sut.deleteByCriteria(undefined)).resolves.toBe(0);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it("softDelete soft-removes the entity", async () => {
      const { repo, sut } = makeMocks();
      await expect(sut.softDelete(thing)).resolves.toBe(thing);
      expect(repo.softRemove).toHaveBeenCalledWith(thing);
    });
  });

  describe("finders", () => {
    it("findMany passes where, relations and withDeleted", async () => {
      const { repo, sut } = makeMocks();
      repo.find.mockResolvedValue([thing]);
      await expect(sut.findMany({ name: "a" }, ["x"], true)).resolves.toEqual([
        thing,
      ]);
      expect(repo.find).toHaveBeenCalledWith({
        relations: { x: true },
        where: { name: "a" },
        withDeleted: true,
      });
    });

    it("findManyPaginated returns data with paging meta", async () => {
      const { repo, sut } = makeMocks();
      repo.findAndCount.mockResolvedValue([[thing], 7]);
      const result = await sut.findManyPaginated({
        orderBy: { name: "ASC" },
        pagination: { skip: 10, limit: 5, page: 3 },
        params: { name: "a" },
      });
      expect(result).toEqual({ count: 7, data: [thing], limit: 5, page: 3 });
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 5, order: { name: "ASC" } }),
      );
    });

    it("findManyPaginated works without pagination", async () => {
      const { repo, sut } = makeMocks();
      repo.findAndCount.mockResolvedValue([[], 0]);
      await expect(sut.findManyPaginated({})).resolves.toEqual({
        count: 0,
        data: [],
        limit: undefined,
        page: undefined,
      });
    });

    it("findManyPaginated maps an Error to DatabaseQueryError and logs it", async () => {
      const { repo, logger, sut } = makeMocks();
      repo.findAndCount.mockRejectedValue(new Error("boom"));
      await expect(sut.findManyPaginated({})).rejects.toBeInstanceOf(
        DatabaseQueryError,
      );
      expect(logger.error).toHaveBeenCalledWith("boom");
    });

    it("findManyPaginated stringifies non-Error rejections", async () => {
      const { repo, logger, sut } = makeMocks();
      repo.findAndCount.mockRejectedValue("weird");
      await expect(sut.findManyPaginated({})).rejects.toBeInstanceOf(
        DatabaseQueryError,
      );
      expect(logger.error).toHaveBeenCalledWith("weird");
    });

    it("findOne returns null when there are no params", async () => {
      const { repo, sut } = makeMocks();
      await expect(sut.findOne(undefined)).resolves.toBeNull();
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it("findOne queries by params", async () => {
      const { repo, sut } = makeMocks();
      repo.findOne.mockResolvedValue(thing);
      await expect(sut.findOne({ name: "a" }, undefined, true)).resolves.toBe(
        thing,
      );
      expect(repo.findOne).toHaveBeenCalledWith({
        relations: undefined,
        where: { name: "a" },
        withDeleted: true,
      });
    });

    it("findOneByIdOrThrow returns the row", async () => {
      const { repo, sut } = makeMocks();
      repo.findOne.mockResolvedValue(thing);
      await expect(sut.findOneByIdOrThrow("id-1")).resolves.toBe(thing);
      expect(repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "id-1" } }),
      );
    });

    it("findOneByIdOrThrow throws EntityByIdNotFoundError when missing", async () => {
      const { repo, sut } = makeMocks();
      repo.findOne.mockResolvedValue(null);
      await expect(sut.findOneByIdOrThrow("nope")).rejects.toThrow(
        new EntityByIdNotFoundError("things", "nope"),
      );
    });

    it("findOneOrThrow returns the row", async () => {
      const { repo, sut } = makeMocks();
      repo.findOne.mockResolvedValue(thing);
      await expect(sut.findOneOrThrow({ name: "a" })).resolves.toBe(thing);
    });

    it("findOneOrThrow throws EntityNotFoundError when missing", async () => {
      const { repo, sut } = makeMocks();
      repo.findOne.mockResolvedValue(null);
      await expect(sut.findOneOrThrow({ name: "zzz" })).rejects.toBeInstanceOf(
        EntityNotFoundError,
      );
    });
  });

  describe("save", () => {
    it("returns the persisted entity", async () => {
      const { repo, sut } = makeMocks();
      repo.save.mockResolvedValue(thing);
      await expect(sut.save(thing)).resolves.toBe(thing);
    });

    it("maps a unique violation to UniqueConstraintViolationError", async () => {
      const { repo, sut } = makeMocks();
      repo.save.mockRejectedValue(
        new QueryFailedError("INSERT", [], {
          code: PostgresErrorCode.UniqueViolation,
          detail: "Key (name)=(a) already exists.",
        } as unknown as Error),
      );
      const err = await sut.save(thing).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UniqueConstraintViolationError);
      expect((err as Error).message).toContain("Key (name)=(a)");
    });

    it("uses an empty detail when the driver gives none", async () => {
      const { repo, sut } = makeMocks();
      repo.save.mockRejectedValue(
        new QueryFailedError("INSERT", [], {
          code: PostgresErrorCode.UniqueViolation,
        } as unknown as Error),
      );
      await expect(sut.save(thing)).rejects.toThrow(
        "Unique constraint violation on things: ",
      );
    });

    it("maps other query failures to DatabaseQueryError", async () => {
      const { repo, logger, sut } = makeMocks();
      repo.save.mockRejectedValue(
        new QueryFailedError("INSERT", [], {
          code: PostgresErrorCode.ForeignKeyViolation,
        } as unknown as Error),
      );
      await expect(sut.save(thing)).rejects.toBeInstanceOf(DatabaseQueryError);
      expect(logger.error).toHaveBeenCalled();
    });

    it("maps non-TypeORM errors to DatabaseQueryError", async () => {
      const { repo, sut } = makeMocks();
      repo.save.mockRejectedValue(new Error("conn lost"));
      await expect(sut.save(thing)).rejects.toBeInstanceOf(DatabaseQueryError);
    });

    it("stringifies non-Error rejections", async () => {
      const { repo, logger, sut } = makeMocks();
      repo.save.mockRejectedValue(42);
      await expect(sut.save(thing)).rejects.toBeInstanceOf(DatabaseQueryError);
      expect(logger.error).toHaveBeenCalledWith("42");
    });
  });

  describe("saveMultiple", () => {
    it("returns the saved entities", async () => {
      const { repo, sut } = makeMocks();
      repo.save.mockResolvedValue([thing]);
      await expect(sut.saveMultiple([thing])).resolves.toEqual([thing]);
    });

    it("maps failures to DatabaseQueryError", async () => {
      const { repo, sut } = makeMocks();
      repo.save.mockRejectedValue(new Error("x"));
      await expect(sut.saveMultiple([thing])).rejects.toBeInstanceOf(
        DatabaseQueryError,
      );
      repo.save.mockRejectedValue("y");
      await expect(sut.saveMultiple([thing])).rejects.toBeInstanceOf(
        DatabaseQueryError,
      );
    });
  });

  describe("upsert", () => {
    it("is a no-op for an empty list", async () => {
      const { repo, sut } = makeMocks();
      await sut.upsert([], ["id"]);
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it("delegates to the repository", async () => {
      const { repo, sut } = makeMocks();
      await sut.upsert([thing], ["id"]);
      expect(repo.upsert).toHaveBeenCalledWith([thing], ["id"]);
    });

    it("maps failures to DatabaseQueryError", async () => {
      const { repo, sut } = makeMocks();
      repo.upsert.mockRejectedValue(new Error("x"));
      await expect(sut.upsert([thing], ["id"])).rejects.toBeInstanceOf(
        DatabaseQueryError,
      );
      repo.upsert.mockRejectedValue("y");
      await expect(sut.upsert([thing], ["id"])).rejects.toBeInstanceOf(
        DatabaseQueryError,
      );
    });
  });

  describe("count / exists", () => {
    it("count passes the where clause", async () => {
      const { repo, sut } = makeMocks();
      repo.count.mockResolvedValue(4);
      await expect(sut.count({ name: "a" })).resolves.toBe(4);
      expect(repo.count).toHaveBeenCalledWith({ where: { name: "a" } });
    });

    it("exists is false without params", async () => {
      const { repo, sut } = makeMocks();
      await expect(sut.exists(undefined)).resolves.toBe(false);
      expect(repo.count).not.toHaveBeenCalled();
    });

    it("exists reflects the count", async () => {
      const { repo, sut } = makeMocks();
      repo.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      await expect(sut.exists({ name: "a" })).resolves.toBe(true);
      await expect(sut.exists({ name: "b" })).resolves.toBe(false);
    });
  });
});
