import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

import { validationException } from './common/errors';

/** Shared by main.ts and the e2e tests, so tests run against the real HTTP setup. */
export function configureApp(app: INestApplication) {
  const express = app as NestExpressApplication;
  express.disable('x-powered-by');
  // The web app proxies /api to this server, so trust the proxy's X-Forwarded-For for
  // client IPs (rate limiting, audit). Defaults to loopback; set TRUST_PROXY to change it.
  express.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationException,
    }),
  );
  return app;
}
