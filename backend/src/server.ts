import type { Server } from 'node:http';
import { createApp } from './app.js';
import {
  connectToDatabase,
  disconnectFromDatabase,
  getSafeDatabaseError,
} from './config/database.js';
import { getEnvironment } from './config/env.js';
import { createLogger } from './lib/logger.js';

async function startServer(): Promise<void> {
  const bootstrapLogger = createLogger({ service: 'mamladibe-backend' });

  try {
    const env = getEnvironment();
    const logger = createLogger({ service: 'mamladibe-backend' }, env.logLevel);
    let server: Server | undefined;

    const shutdown = async (signal: string): Promise<void> => {
      logger.info({ signal }, 'Shutdown signal received');
      const forceExitTimer = setTimeout(() => {
        logger.error({ signal }, 'Forced shutdown after graceful timeout');
        process.exit(1);
      }, 10_000);
      forceExitTimer.unref();

      if (server) {
        server.closeIdleConnections?.();
        await new Promise<void>((resolve) => {
          server?.close(() => resolve());
        });
      }
      await disconnectFromDatabase().catch((err: unknown) => {
        logger.error(
          { err: getSafeDatabaseError(err) },
          'Error closing MongoDB connection during shutdown',
        );
      });
      clearTimeout(forceExitTimer);
      process.exitCode = 0;
    };

    process.once('SIGINT', () => {
      void shutdown('SIGINT');
    });
    process.once('SIGTERM', () => {
      void shutdown('SIGTERM');
    });

    await connectToDatabase(env.dbName);
    logger.info({ dbName: env.dbName }, 'MongoDB connected');

    const app = createApp({
      allowedOrigins: env.allowedOrigins,
      logger,
    });

    server = app.listen(env.port, () => {
      logger.info(
        { port: env.port, nodeEnv: env.nodeEnv },
        'Mamladibe backend listening',
      );
    });
  } catch (error) {
    bootstrapLogger.fatal(
      {
        err: getSafeDatabaseError(error),
      },
      'Backend startup failed',
    );
    process.exitCode = 1;
  }
}

void startServer();
