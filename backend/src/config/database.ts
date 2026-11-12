import mongoose from 'mongoose';
import { PATTERNS } from '../constants/index.js';
import { redactMongoUris } from '../utils/text.js';
import { getDatabaseEnvironment } from './env.js';

export const TEST_DATABASE_NAME = 'mamladibe_test';

export const MONGOOSE_CONNECTION_OPTIONS = {
  maxPoolSize: 5,
  serverSelectionTimeoutMS: 5000,
  autoIndex: false,
} as const;

interface GlobalMongoCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
  dbName: string | null;
}

const globalForMongo = globalThis as typeof globalThis & {
  __mamladibeMongoCache?: GlobalMongoCache;
};

function getMongoCache(): GlobalMongoCache {
  if (!globalForMongo.__mamladibeMongoCache) {
    globalForMongo.__mamladibeMongoCache = {
      conn: null,
      promise: null,
      dbName: null,
    };
  }

  return globalForMongo.__mamladibeMongoCache;
}

export function resetDatabaseConnectionCache(): void {
  const cache = getMongoCache();
  cache.conn = null;
  cache.promise = null;
  cache.dbName = null;
}

export function getSafeDatabaseError(error: unknown): {
  name: string;
  code?: string | number;
} {
  if (error instanceof Error) {
    const code: unknown = Reflect.get(error, 'code');
    return {
      name: error.name,
      ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
    };
  }

  return { name: 'UnknownError' };
}

function sanitizeDatabaseError(error: unknown): Error {
  if (error instanceof Error) {
    const safeError = new Error(redactMongoUris(error.message));
    safeError.name = error.name;
    const code: unknown = Reflect.get(error, 'code');
    if (typeof code === 'string' || typeof code === 'number') {
      Reflect.set(safeError, 'code', code);
    }
    return safeError;
  }

  return new Error('MongoDB connection failed.');
}

export function connectToDatabase(
  databaseName?: string,
): Promise<typeof mongoose> {
  if (databaseName !== undefined && !PATTERNS.DATABASE_NAME.test(databaseName)) {
    throw new Error('A valid MongoDB database name is required to connect.');
  }

  const environment = getDatabaseEnvironment();
  const targetDatabaseName = databaseName ?? environment.dbName;

  if (!PATTERNS.DATABASE_NAME.test(targetDatabaseName)) {
    throw new Error('A valid MongoDB database name is required to connect.');
  }

  const cache = getMongoCache();
  const cachedReadyState = cache.conn?.connection?.readyState;

  // If a real connection was closed externally, drop the stale cached handle
  if (cache.conn && cachedReadyState === 0) {
    cache.conn = null;
    cache.dbName = null;
  }

  if (cache.conn && (cachedReadyState === 1 || cachedReadyState === undefined)) {
    if (cache.dbName !== targetDatabaseName) {
      throw new Error(
        'MongoDB is already connected to a different database in this process.',
      );
    }
    return Promise.resolve(cache.conn);
  }

  if (cache.promise) {
    if (cache.dbName !== targetDatabaseName) {
      throw new Error(
        'MongoDB is already connecting to a different database in this process.',
      );
    }
    return cache.promise;
  }

  cache.dbName = targetDatabaseName;
  cache.promise = mongoose
    .connect(environment.mongoUri, {
      ...MONGOOSE_CONNECTION_OPTIONS,
      dbName: targetDatabaseName,
    })
    .then((client) => {
      const connectedDatabaseName = client.connection.db?.databaseName;

      if (connectedDatabaseName !== targetDatabaseName) {
        throw new Error(
          'MongoDB connected to an unexpected database; refusing to continue.',
        );
      }

      cache.conn = client;
      return client;
    })
    .catch(async (error: unknown) => {
      resetDatabaseConnectionCache();
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect().catch(() => undefined);
      }
      throw sanitizeDatabaseError(error);
    });

  return cache.promise;
}

export function connectToTestDatabase(): Promise<typeof mongoose> {
  return connectToDatabase(TEST_DATABASE_NAME);
}

export async function disconnectFromDatabase(): Promise<void> {
  resetDatabaseConnectionCache();
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

export async function pingDatabase(): Promise<void> {
  const database = mongoose.connection.db;

  if (mongoose.connection.readyState !== 1 || !database) {
    throw new Error('MongoDB is not connected.');
  }

  await database.admin().ping();
}

export function getDatabaseReadyState(): 'disconnected' | 'connected' | 'connecting' | 'disconnecting' {
  switch (mongoose.connection.readyState) {
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    case 3:
      return 'disconnecting';
    default:
      return 'disconnected';
  }
}
