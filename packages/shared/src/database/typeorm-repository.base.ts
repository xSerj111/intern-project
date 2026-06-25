import type {
  FindOptionsOrder,
  FindOptionsRelations,
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
} from "typeorm";

import { Logger, WinstonLogger } from "../logger";
import {
  DatabaseQueryError,
  EntityByIdNotFoundError,
  EntityNotFoundError,
  UniqueConstraintViolationError,
} from "../errors/database.errors";
import { PostgresErrorCode } from "./postgres-error-code.enum";
import { isTypeOrmError } from "./typeorm-error.guard";
import type {
  DataWithPaginationMeta,
  FindManyPaginatedParams,
  QueryParams,
  RepositoryPort,
} from "./repository.port";

export type WhereCondition<Entity> =
  | Array<FindOptionsWhere<Entity>>
  | FindOptionsWhere<Entity>;

/**
 * TypeORM adapter for {@link RepositoryPort}. Concrete repositories extend this,
 * declare a `static readonly entity` and the default `relations`, and add their
 * own domain-specific finders. Wraps a `Repository<Entity>` (composition) rather
 * than extending it, so the public surface is exactly the port.
 */
export abstract class TypeormRepositoryBase<
  Entity extends ObjectLiteral,
  EntityProps,
> implements RepositoryPort<Entity, EntityProps> {
  protected readonly logger: Logger;
  protected abstract relations: string[];

  protected constructor(
    protected readonly repository: Repository<Entity>,
    logger?: Logger,
  ) {
    // Defaults to the shared WinstonLogger; inject another Logger to override.
    this.logger = logger ?? new WinstonLogger(this.constructor.name);
  }

  protected get tableName(): string {
    return this.repository.metadata.tableName;
  }

  protected prepareQuery(
    params: QueryParams<EntityProps>,
  ): WhereCondition<Entity> | undefined {
    if (!params) return undefined;
    return params as unknown as WhereCondition<Entity>;
  }

  /**
   * The port exposes relations as `string[]` (domain-friendly), but TypeORM v1
   * removed the string-array form and requires the object syntax
   * (`{ author: true }`). Convert here; empty -> `undefined` (no relations).
   * Dotted paths (`a.b`) become nested objects.
   */
  protected resolveRelations(
    relations?: string[],
  ): FindOptionsRelations<Entity> | undefined {
    const names = relations ?? this.relations;
    if (!names || names.length === 0) return undefined;

    const tree: Record<string, unknown> = {};
    for (const path of names) {
      let node = tree;
      const segments = path.split(".");
      segments.forEach((segment, index) => {
        if (index === segments.length - 1) {
          node[segment] = node[segment] ?? true;
        } else {
          node[segment] = (node[segment] as Record<string, unknown>) ?? {};
          node = node[segment] as Record<string, unknown>;
        }
      });
    }
    return tree as FindOptionsRelations<Entity>;
  }

  public async delete(entity: Entity): Promise<Entity> {
    await this.repository.remove(entity);
    this.logger.debug(`[${entity.constructor.name}] deleted ${entity.id}`);
    return entity;
  }

  public async deleteMultiple(entities: Entity[]): Promise<Entity[]> {
    await this.repository.remove(entities);
    return entities;
  }

  public async deleteByCriteria(
    criteria: QueryParams<EntityProps>,
  ): Promise<number> {
    const where = this.prepareQuery(criteria);
    if (!where) return 0;

    const result = await this.repository.delete(where);
    return result.affected ?? 0;
  }

  public async softDelete(entity: Entity): Promise<Entity> {
    await this.repository.softRemove(entity);
    this.logger.debug(`[${entity.constructor.name}] soft deleted ${entity.id}`);
    return entity;
  }

  public async findMany(
    params?: QueryParams<EntityProps>,
    relations?: string[],
    withDeleted?: boolean,
  ): Promise<Entity[]> {
    return this.repository.find({
      relations: this.resolveRelations(relations),
      where: this.prepareQuery(params),
      withDeleted,
    });
  }

  public async findManyPaginated({
    orderBy,
    pagination,
    params,
    relations,
  }: FindManyPaginatedParams<EntityProps>): Promise<
    DataWithPaginationMeta<Entity[]>
  > {
    try {
      const [data, count] = await this.repository.findAndCount({
        order: orderBy as unknown as FindOptionsOrder<Entity>,
        relations: this.resolveRelations(relations),
        skip: pagination?.skip,
        take: pagination?.limit,
        where: this.prepareQuery(params),
      });

      return { count, data, limit: pagination?.limit, page: pagination?.page };
    } catch (err: unknown) {
      this.logger.error(err instanceof Error ? err.message : String(err));
      throw new DatabaseQueryError();
    }
  }

  public async findOne(
    params: QueryParams<EntityProps>,
    relations?: string[],
    withDeleted?: boolean,
  ): Promise<Entity | null> {
    const where = this.prepareQuery(params);
    if (!where) return null;

    return this.repository.findOne({
      relations: this.resolveRelations(relations),
      where,
      withDeleted,
    });
  }

  public async findOneByIdOrThrow(
    id: string | number,
    relations?: string[],
  ): Promise<Entity> {
    const found = await this.repository.findOne({
      relations: this.resolveRelations(relations),
      where: { id } as unknown as FindOptionsWhere<Entity>,
    });

    if (!found) {
      throw new EntityByIdNotFoundError(this.tableName, id);
    }
    return found;
  }

  public async findOneOrThrow(
    params: QueryParams<EntityProps>,
    relations?: string[],
  ): Promise<Entity> {
    const found = await this.findOne(params, relations);

    if (!found) {
      throw new EntityNotFoundError(this.tableName, params);
    }
    return found;
  }

  public async save(entity: Entity): Promise<Entity> {
    try {
      const result = await this.repository.save(entity);
      this.logger.debug(`[${entity.constructor.name}] persisted ${result.id}`);
      return result;
    } catch (err: unknown) {
      if (
        isTypeOrmError(err) &&
        err.driverError?.code === PostgresErrorCode.UniqueViolation
      ) {
        throw new UniqueConstraintViolationError(
          this.tableName,
          err.driverError.detail ?? "",
        );
      }
      this.logger.error(err instanceof Error ? err.message : String(err));
      throw new DatabaseQueryError();
    }
  }

  public async saveMultiple(entities: Entity[]): Promise<Entity[]> {
    try {
      return await this.repository.save(entities);
    } catch (err: unknown) {
      this.logger.error(err instanceof Error ? err.message : String(err));
      throw new DatabaseQueryError();
    }
  }

  public async upsert(
    entities: Entity[],
    conflictKeys: string[],
  ): Promise<void> {
    if (entities.length === 0) return;

    try {
      await this.repository.upsert(entities, conflictKeys);
    } catch (err: unknown) {
      this.logger.error(err instanceof Error ? err.message : String(err));
      throw new DatabaseQueryError();
    }
  }

  public async count(params?: QueryParams<EntityProps>): Promise<number> {
    return this.repository.count({ where: this.prepareQuery(params) });
  }

  public async exists(params: QueryParams<EntityProps>): Promise<boolean> {
    const where = this.prepareQuery(params);
    if (!where) return false;
    // Implemented via count() to stay compatible across TypeORM versions.
    return (await this.repository.count({ where })) > 0;
  }
}
