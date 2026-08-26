import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { NotificationsModule } from './notifications/notifications.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    NotificationsModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: ['amqp://localhost:5672'], // Domyslny adres lokalnego RabbitMQ
        queue: 'notifications_queue',
        queueOptions: {
          durable: true, // Kolejka przetrwa restart serwera
        },
      },
    },
  );
  await app.listen();
}
bootstrap();
