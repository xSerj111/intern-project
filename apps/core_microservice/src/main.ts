import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import 'reflect-metadata';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('Innogram Core API')
    .setDescription('The social graph, content, and interactions layer')
    .setVersion('1.0')
    .addTag('Profiles')
    .addTag('Posts')
    .addTag('Comments')
    .build();
    
  const document = SwaggerModule.createDocument(app, config);
  // This hosts the UI at http://localhost:3002/api
  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT || 3002);
  console.log(`Core microservice runs on ${process.env.PORT}`);
}
bootstrap();
