import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Outbox correlation: the request id that wrote the row, published as the
 * `x-correlation-id` message header. Nullable, so existing rows stay valid.
 */
export class AddOutboxCorrelationId1792470000000 implements MigrationInterface {
  name = 'AddOutboxCorrelationId1792470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "outbox_events" ADD "correlation_id" character varying(128)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "outbox_events" DROP COLUMN "correlation_id"`,
    );
  }
}
