import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { parseAllowedOrigins } from './config/env.js';
import { LIMITS } from './constants/index.js';
import { createLogger, type StructuredLogger } from './lib/logger.js';
import { errorHandlerMiddleware } from './middleware/error-handler.middleware.js';
import { notFoundMiddleware } from './middleware/not-found.middleware.js';
import { createRequestIdMiddleware } from './middleware/request-id.middleware.js';
import { requestLoggerMiddleware } from './middleware/request-logger.middleware.js';
import { createApiV1Router } from './routes/index.js';

export interface CreateAppOptions {
  allowedOrigins?: readonly string[];
  logger?: StructuredLogger;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const baseLogger = options.logger ?? createLogger();
  const allowedOrigins = new Set(
    options.allowedOrigins ?? parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
  );

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(createRequestIdMiddleware(baseLogger));
  app.use(requestLoggerMiddleware);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'", 'https://tiles.openfreemap.org'],
          imgSrc: ["'self'", 'data:', 'https://tiles.openfreemap.org'],
          workerSrc: ["'self'", 'blob:'],
          frameSrc: ['https://challenges.cloudflare.com'],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
      },
      referrerPolicy: {
        policy: 'same-origin',
      },
      frameguard: {
        action: 'deny',
      },
    }),
  );

  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'geolocation=(self)');
    next();
  });

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }

        if (allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }

        callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'x-csrf-token', 'X-Request-Id'],
    }),
  );

  app.use(express.json({ limit: LIMITS.JSON_BODY_LIMIT }));
  app.use(cookieParser());

  app.use('/api/v1', createApiV1Router(Array.from(allowedOrigins)));

  app.use(notFoundMiddleware);
  app.use(errorHandlerMiddleware);

  return app;
}

const app = createApp();

export default app;
