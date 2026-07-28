import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Follow } from './domain/entities/follow.entity';
import { FollowsController } from './follows.controller';
import { FollowsService } from './follows.service';
import { FollowRepository } from './infrastructure/repository/follow.repository';
import { LoggerModule } from '@repo/shared';

@Module({
  imports: [
    TypeOrmModule.forFeature([Follow]),
    LoggerModule.forFeature('FollowsService'),
  ],
  controllers: [FollowsController],
  providers: [FollowsService, FollowRepository],
  exports: [FollowsService],
})
export class FollowsModule {}
