import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: false });
  app.setGlobalPrefix('api/v1');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Michel Core API')
      .setDescription('Local-first API for Michel OS')
      .setVersion('1.0')
      .addCookieAuth('michel_session')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}

void bootstrap();
