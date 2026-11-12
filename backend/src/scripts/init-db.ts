import {
  connectToDatabase,
  disconnectFromDatabase,
  getSafeDatabaseError,
} from '../config/database.js';
import { getDatabaseEnvironment } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import {
  assertSafeInitializationTarget,
  initializeDatabase,
  type MongoDbHandle,
} from '../services/db-init.service.js';
import { redactMongoUris } from '../utils/text.js';

function parseCliFlags(argv: readonly string[]): {
  dryRun: boolean;
  confirmProduction: boolean;
} {
  return {
    dryRun: argv.includes('--dry-run'),
    confirmProduction: argv.includes('--confirm-production'),
  };
}

async function run(): Promise<void> {
  const bootstrapLogger = createLogger({ script: 'init-db' });

  try {
    const environment = getDatabaseEnvironment();
    const logger = createLogger({ script: 'init-db' }, environment.logLevel);
    const { dryRun, confirmProduction } = parseCliFlags(process.argv.slice(2));
    const allowProductionEnv = process.env.ALLOW_PRODUCTION_DB_INIT === 'true';

    assertSafeInitializationTarget({
      nodeEnv: environment.nodeEnv,
      databaseName: environment.dbName,
      dryRun,
      confirmProduction,
      allowProductionEnv,
    });

    const client = await connectToDatabase(environment.dbName);
    const db = client.connection.db;

    if (!db) {
      throw new Error('MongoDB connection handle has no active database.');
    }

    const report = await initializeDatabase(db as unknown as MongoDbHandle, {
      nodeEnv: environment.nodeEnv,
      dryRun,
      confirmProduction,
      allowProductionEnv,
    });

    logger.info(
      {
        databaseName: report.databaseName,
        nodeEnv: report.nodeEnv,
        dryRun: report.dryRun,
        totals: report.totals,
        hasConflicts: report.hasConflicts,
      },
      'Database initialization completed',
    );

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    if (report.hasConflicts) {
      logger.warn(
        { indexesDifferent: report.totals.indexesDifferent },
        'Existing indexes differ from declared schema indexes; review conflicts manually without dropping data.',
      );
      process.exitCode = 1;
    }
  } catch (error) {
    bootstrapLogger.error(
      { err: getSafeDatabaseError(error) },
      'Database initialization failed',
    );
    const safeMessage =
      error instanceof Error
        ? redactMongoUris(error.message)
        : 'Database initialization failed.';
    process.stderr.write(`${safeMessage}\n`);
    process.exitCode = 1;
  } finally {
    await disconnectFromDatabase().catch(() => undefined);
  }
}

void run();
