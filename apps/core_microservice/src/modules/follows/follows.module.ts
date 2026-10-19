import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Follow } from './domain/entities/follow.entity';
import { FollowsController } from './follows.controller';
import { FollowsService } from './follows.service';
import { FollowRepository } from './infrastructure/repository/follow.repository';
import { FollowRepositoryKey } from './domain/interfaces/follow-repository.port';
import { LoggerModule } from '@repo/shared';
import { ProfilesModule } from '../profiles/profiles.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Follow]),
    LoggerModule.forFeature('FollowsService'),
    ProfilesModule,
  ],
  controllers: [FollowsController],
  providers: [
    FollowsService,
    FollowRepository,
    { provide: FollowRepositoryKey, useExisting: FollowRepository },
  ],
  exports: [FollowsService, FollowRepositoryKey],
})
export class FollowsModule {}
