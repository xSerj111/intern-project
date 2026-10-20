import {
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * Base class for TypeORM entities, shared across all services.
 *
 * Provides the identity + audit/soft-delete columns every entity shares, so
 * domain entities only declare their own fields and business logic. Named
 * `TypeormEntityBase` (not `BaseEntity`) to avoid clashing with TypeORM's
 * ActiveRecord `BaseEntity`.
 */
export abstract class TypeormEntityBase {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;

  @DeleteDateColumn({ type: "timestamptz" })
  deletedAt!: Date;
}
