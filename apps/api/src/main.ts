import 'reflect-metadata';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import {
  LOCALE_HEADER,
  LocaleExceptionFilter,
  LocaleInterceptor,
} from './platform/i18n/locale.interceptor';

const mobileWebCorsOrigins = new Set([
  'http://localhost:8081',
  'http://localhost:8082',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:8082',
  ...(process.env.ELISE_WEB_CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
]);
const mobileWebCorsOptions: CorsOptions = {
  origin: (origin, callback) => {
    callback(null, origin && mobileWebCorsOrigins.has(origin) ? origin : false);
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Accept', 'Authorization', 'Content-Type', LOCALE_HEADER],
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: false });
  // The dashboard proxy (Caddy) runs on the private Docker network: trust its X-Forwarded-For
  // so each caregiver keeps their own address, for instance in the login throttle.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.enableCors(mobileWebCorsOptions);
  app.setGlobalPrefix('api/v1');
  // Texts Élise writes itself reach English-speaking caregivers in English.
  app.useGlobalInterceptors(new LocaleInterceptor());
  app.useGlobalFilters(new LocaleExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.enableShutdownHooks();

  // The API map helps development; a home box has no reason to publish it.
  if (process.env.NODE_ENV !== 'production' || process.env.ELISE_API_DOCS === 'true') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Élise Core API')
        .setDescription('Local-first API for Élise OS')
        .setVersion('1.0')
        .addCookieAuth('elise_session')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}

void bootstrap();
