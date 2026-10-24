import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import { AlertsService } from './common/alerts/alerts.service.js';
import { createAppLogger, useJsonLogs } from './common/logging/app-logger.js';
import { REQUEST_ID_HEADER, requestContext } from './common/logging/request-context.middleware.js';

// The logger is built before ConfigModule loads .env, so pick up its log settings here.
// Only these keys: everything else is left to ConfigModule. The real environment wins.
try {
  const fileEnv = parseEnv(readFileSync('.env', 'utf8'));
  for (const key of ['LOG_FORMAT', 'NODE_ENV']) {
    if (process.env[key] === undefined && fileEnv[key] !== undefined) process.env[key] = fileEnv[key];
  }
} catch {
  // No .env file: rely on the environment.
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const json = useJsonLogs();
  // rawBody: the Paystack webhook signature is computed over the exact bytes received.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    logger: createAppLogger(json),
  });
  // Behind nginx: take the client IP from X-Forwarded-For (used by rate limiting).
  app.set('trust proxy', 1);
  app.use(requestContext({ json }));

  // FRONTEND_URL may list several origins separated by commas (e.g. QA and production web apps).
  const frontendOrigins = (process.env.FRONTEND_URL ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      ...frontendOrigins,
    ],
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  const alerts = app.get(AlertsService);
  app.useGlobalFilters(new GlobalExceptionFilter(alerts));
  watchProcess(alerts);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  logger.log(`AfroCouture AI API running on http://localhost:${port}`);
}

/** Errors that escape every handler: alert, and for a crash give the alert a moment before PM2 restarts us. */
function watchProcess(alerts: AlertsService) {
  const logger = new Logger('Process');
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error(`Unhandled promise rejection: ${err.message}`, err.stack);
    alerts.notify({
      title: 'Unhandled promise rejection',
      details: err.stack ?? err.message,
      signature: `unhandledRejection:${err.message}`,
    });
  });
  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception, exiting: ${err.message}`, err.stack);
    const exit = () => process.exit(1);
    setTimeout(exit, 5000).unref();
    void alerts
      .send({ title: 'API crashed (uncaught exception) — restarting', details: err.stack ?? err.message, signature: `uncaught:${err.message}` })
      .finally(exit);
  });
}

await bootstrap();
