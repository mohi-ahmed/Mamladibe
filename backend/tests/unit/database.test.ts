import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectToDatabase,
  connectToTestDatabase,
  getSafeDatabaseError,
  MONGOOSE_CONNECTION_OPTIONS,
  pingDatabase,
  resetDatabaseConnectionCache,
  TEST_DATABASE_NAME,
} from '../../src/config/database.js';

describe('database configuration and connection management', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetDatabaseConnectionCache();
    process.env.NODE_ENV = 'test';
    process.env.DB_NAME = TEST_DATABASE_NAME;
    process.env.MONGODB_URI = 'mongodb://user:supersecret@localhost:27017';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetDatabaseConnectionCache();
    process.env = { ...originalEnv };
  });

  it('configures maxPoolSize=5 and autoIndex=false', () => {
    expect(MONGOOSE_CONNECTION_OPTIONS.maxPoolSize).toBe(5);
    expect(MONGOOSE_CONNECTION_OPTIONS.autoIndex).toBe(false);
    expect(TEST_DATABASE_NAME).toBe('mamladibe_test');
  });

  it('rejects invalid database names before connecting', () => {
    expect(() => connectToDatabase('mamladibe/production')).toThrow(
      /valid MongoDB database name/,
    );
  });

  it('summarizes database errors without exposing credentials or messages', () => {
    const error = Object.assign(
      new Error('authentication failed for mongodb://user:secret@host:27017'),
      { code: 8000 },
    );

    expect(getSafeDatabaseError(error)).toEqual({
      name: 'Error',
      code: 8000,
    });
  });

  it('caches and reuses the Mongoose connection with pool size 5 and autoIndex=false in production', async () => {
    process.env.NODE_ENV = 'production';
    const fakeClient = {
      connection: {
        readyState: 1,
        db: { databaseName: 'mamladibe' },
      },
    } as unknown as typeof mongoose;

    const connectSpy = vi
      .spyOn(mongoose, 'connect')
      .mockResolvedValueOnce(fakeClient);

    const first = await connectToDatabase('mamladibe');
    const second = await connectToDatabase('mamladibe');

    expect(first).toBe(fakeClient);
    expect(second).toBe(fakeClient);
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(connectSpy).toHaveBeenCalledWith(
      process.env.MONGODB_URI,
      expect.objectContaining({
        dbName: 'mamladibe',
        maxPoolSize: 5,
        autoIndex: false,
      }),
    );
  });

  it('connects to the dedicated test database via connectToTestDatabase', async () => {
    const fakeClient = {
      connection: {
        readyState: 1,
        db: { databaseName: TEST_DATABASE_NAME },
      },
    } as unknown as typeof mongoose;

    const connectSpy = vi
      .spyOn(mongoose, 'connect')
      .mockResolvedValueOnce(fakeClient);

    await connectToTestDatabase();

    expect(connectSpy).toHaveBeenCalledWith(
      process.env.MONGODB_URI,
      expect.objectContaining({
        dbName: TEST_DATABASE_NAME,
        maxPoolSize: 5,
        autoIndex: false,
      }),
    );
  });

  it('refuses connecting to a different database when already connected', async () => {
    const fakeClient = {
      connection: {
        readyState: 1,
        db: { databaseName: TEST_DATABASE_NAME },
      },
    } as unknown as typeof mongoose;

    vi.spyOn(mongoose, 'connect').mockResolvedValueOnce(fakeClient);

    await connectToTestDatabase();

    expect(() => connectToDatabase('mamladibe')).toThrow(
      /already connected to a different database/,
    );
  });

  it('resets cached connection promise on failure and redacts URIs from thrown error messages', async () => {
    const connectSpy = vi
      .spyOn(mongoose, 'connect')
      .mockRejectedValueOnce(
        new Error('failed connecting to mongodb+srv://admin:secret@cluster.mongodb.net/mamladibe'),
      )
      .mockResolvedValueOnce({
        connection: {
          readyState: 1,
          db: { databaseName: TEST_DATABASE_NAME },
        },
      } as unknown as typeof mongoose);

    let thrown: unknown;
    try {
      await connectToTestDatabase();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    if (thrown instanceof Error) {
      expect(thrown.message).not.toContain('secret');
      expect(thrown.message).toContain('[REDACTED_MONGODB_URI]');
    }

    await connectToTestDatabase();
    expect(connectSpy).toHaveBeenCalledTimes(2);
  });

  it('rejects if connected database name differs from target database name', async () => {
    vi.spyOn(mongoose, 'connect').mockResolvedValueOnce({
      connection: {
        readyState: 1,
        db: { databaseName: 'wrong_db' },
      },
    } as unknown as typeof mongoose);

    await expect(connectToTestDatabase()).rejects.toThrow(
      /unexpected database/,
    );
  });

  it('throws on pingDatabase when MongoDB is disconnected', async () => {
    await expect(pingDatabase()).rejects.toThrow(/not connected/);
  });
});
