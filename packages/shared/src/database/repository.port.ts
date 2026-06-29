/**
 * Generic data-access port (hexagonal "port"). Domain/application code depends
 * on this interface; the TypeORM adapter (`TypeormRepositoryBase`) implements it.
 *
 * `EntityProps` is the entity's domain props interface (not the class), so query
 * params are type-checked against real columns.
 */

export type QueryParams<EntityProps> = Partial<EntityProps> | undefined;

export interface PaginationMeta {
  limit?: number;
  page?: number;
  skip?: number;
}

export interface FindManyPaginatedParams<EntityProps> {
  orderBy?: Record<string, "ASC" | "DESC">;
  pagination?: PaginationMeta;
  params?: QueryParams<EntityProps>;
  relations?: string[];
}

export interface DataWithPaginationMeta<T> {
  count: number;
  data: T;
  limit?: number;
  page?: number;
}

export interface DeleteOne<Entity> {
  delete(entity: Entity): Promise<Entity>;
}

export interface DeleteMultiple<Entity> {
  deleteMultiple(entities: Entity[]): Promise<Entity[]>;
}

export interface DeleteByCriteria<EntityProps> {
  deleteByCriteria(criteria: QueryParams<EntityProps>): Promise<number>;
}

export interface FindMany<Entity, EntityProps> {
  findMany(
    params?: QueryParams<EntityProps>,
    relations?: string[],
    withDeleted?: boolean,
  ): Promise<Entity[]>;
}

export interface FindManyPaginated<Entity, EntityProps> {
  findManyPaginated(
    options: FindManyPaginatedParams<EntityProps>,
  ): Promise<DataWithPaginationMeta<Entity[]>>;
}

export interface FindOne<Entity, EntityProps> {
  findOne(
    params: QueryParams<EntityProps>,
    relations?: string[],
    withDeleted?: boolean,
  ): Promise<Entity | null>;
}

export interface FindOneByIdOrThrow<Entity> {
  findOneByIdOrThrow(
    id: string | number,
    relations?: string[],
  ): Promise<Entity>;
}

export interface FindOneOrThrow<Entity, EntityProps> {
  findOneOrThrow(
    params: QueryParams<EntityProps>,
    relations?: string[],
  ): Promise<Entity>;
}

export interface Save<Entity> {
  save(entity: Entity): Promise<Entity>;
}

export interface SaveMultiple<Entity> {
  saveMultiple(entities: Entity[]): Promise<Entity[]>;
}

export interface SoftDelete<Entity> {
  softDelete(entity: Entity): Promise<Entity>;
}

export interface Count<EntityProps> {
  count(params?: QueryParams<EntityProps>): Promise<number>;
}

export interface Exists<EntityProps> {
  exists(params: QueryParams<EntityProps>): Promise<boolean>;
}

export interface Upsert<Entity> {
  upsert(entities: Entity[], conflictKeys: string[]): Promise<void>;
}

export interface RepositoryPort<Entity, EntityProps>
  extends
    DeleteOne<Entity>,
    DeleteMultiple<Entity>,
    DeleteByCriteria<EntityProps>,
    FindMany<Entity, EntityProps>,
    FindManyPaginated<Entity, EntityProps>,
    FindOne<Entity, EntityProps>,
    FindOneByIdOrThrow<Entity>,
    FindOneOrThrow<Entity, EntityProps>,
    Save<Entity>,
    SaveMultiple<Entity>,
    SoftDelete<Entity>,
    Count<EntityProps>,
    Exists<EntityProps>,
    Upsert<Entity> {}
