import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import 'reflect-metadata';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);  

  const config = new DocumentBuilder()
    .setTitle('Innogram Auth Api')
    .setDescription('The identity and authentication layer for Innogram')
    .setVersion('1.0')
    .addTag('Users')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT || 3001);
  console.log(`Auth microservice runs on ${process.env.PORT}`);
}
bootstrap();
