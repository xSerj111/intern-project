import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Follow } from './domain/entities/follow.entity';
import { FollowsController } from './follows.controller';
import { FollowsService } from './follows.service';
import { FollowRepository } from './infrastructure/repository/follow.repository';
import { LoggerModule } from '@repo/shared';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { FollowRepositoryKey } from './domain/interfaces/follow-repository.port';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'NOTIFICATIONS_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: ['amqp://localhost:5672'],
          queue: 'notifications_queue',
          queueOptions: { durable: true },
        },
      },
    ]),
    TypeOrmModule.forFeature([Follow]),
    LoggerModule.forFeature('FollowsService'),
  ],
  controllers: [FollowsController],
  providers: [
    FollowsService,
    FollowRepository,
    // Tworzymy most pomiędzy symbolem a klasą
    {
      provide: FollowRepositoryKey,
      useExisting: FollowRepository,
    },
  ],
  exports: [
    FollowsService,
    // Eksportujemy ten symbol, żeby inne moduły mogły z niego korzystać
    FollowRepositoryKey,
  ],
})
export class FollowsModule {}
