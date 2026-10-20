import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Store every audit/soft-delete timestamp as `timestamptz`.
 *
 * Plain `timestamp` columns were written by Postgres in UTC (`now()`) but read
 * back by node-pg as process-local time, so any service not running in UTC
 * served instants shifted by its UTC offset. Existing values are UTC wall
 * time, hence `AT TIME ZONE 'UTC'` in both directions.
 */
const COLUMNS: [table: string, columns: string[]][] = [
  ['auth_sessions', ['createdAt', 'expiresAt']],
  ['auth_users', ['createdAt', 'updatedAt', 'deletedAt']],
];

function alter(type: string): string[] {
  return COLUMNS.map(
    ([table, columns]) =>
      `ALTER TABLE "${table}" ` +
      columns
        .map(
          (column) =>
            `ALTER COLUMN "${column}" TYPE ${type} USING "${column}" AT TIME ZONE 'UTC'`,
        )
        .join(', '),
  );
}

export class TimestampsWithTimeZone1792440000000 implements MigrationInterface {
  name = 'TimestampsWithTimeZone1792440000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of alter('TIMESTAMP WITH TIME ZONE')) {
      await queryRunner.query(sql);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of alter('TIMESTAMP')) {
      await queryRunner.query(sql);
    }
  }
}
