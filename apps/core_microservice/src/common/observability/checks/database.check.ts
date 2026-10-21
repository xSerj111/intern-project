import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { HealthCheck } from '@repo/shared';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseCheck implements HealthCheck {
  readonly name = 'database';
  readonly critical = true;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async run(): Promise<void> {
    await this.dataSource.query('SELECT 1');
  }
}
