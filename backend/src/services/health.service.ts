import mongoose from 'mongoose';
import {
  connectToDatabase,
  getSafeDatabaseError,
  pingDatabase,
} from '../config/database.js';
import { getDatabaseEnvironment } from '../config/env.js';
import type { HealthResponse } from '../types/index.js';

export interface HealthCheckOutcome {
  statusCode: 200 | 503;
  body: HealthResponse;
  safeError?: { name: string; code?: string | number };
}

export async function getHealthStatus(
  pingFn: () => Promise<void> = pingDatabase,
): Promise<HealthCheckOutcome> {
  const timestamp = new Date().toISOString();

  try {
    // Establish the cached Atlas connection on serverless cold starts when health is hit first.
    if (
      pingFn === pingDatabase &&
      process.env.NODE_ENV !== 'test' &&
      mongoose.connection.readyState !== 1
    ) {
      const { dbName } = getDatabaseEnvironment();
      await connectToDatabase(dbName);
    }

    await pingFn();
    return {
      statusCode: 200,
      body: {
        status: 'ok',
        database: 'connected',
        timestamp,
      },
    };
  } catch (error) {
    return {
      statusCode: 503,
      body: {
        status: 'unavailable',
        database: 'disconnected',
        timestamp,
      },
      safeError: getSafeDatabaseError(error),
    };
  }
}

