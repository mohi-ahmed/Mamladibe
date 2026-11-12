import { describe, expect, it, vi } from 'vitest';
import { COLLECTIONS } from '../../src/constants/index.js';
import {
  assertSafeInitializationTarget,
  initializeDatabase,
  type MongoCollectionHandle,
  type MongoDbHandle,
} from '../../src/services/db-init.service.js';

interface FakeIndexEntry {
  spec: Record<string, unknown>;
  doc: Record<string, unknown>;
}

function createFakeMongoDb(
  seedCollections: Record<string, FakeIndexEntry[]> = {},
) {
  const store = new Map<string, FakeIndexEntry[]>();
  const droppedCollections: string[] = [];
  const droppedIndexes: string[] = [];

  for (const [name, indexes] of Object.entries(seedCollections)) {
    store.set(name, [{ spec: { _id: 1 }, doc: { name: '_id_', key: { _id: 1 } } }, ...indexes]);
  }

  const createCollectionSpy = vi.fn(async (name: string) => {
    if (!store.has(name)) {
      store.set(name, [{ spec: { _id: 1 }, doc: { name: '_id_', key: { _id: 1 } } }]);
    }
    return {};
  });

  const createIndexSpies = new Map<string, ReturnType<typeof vi.fn>>();

  const db: MongoDbHandle = {
    databaseName: 'mamladibe_test',
    listCollections: () => ({
      toArray: async () => Array.from(store.keys()).map((name) => ({ name })),
    }),
    createCollection: createCollectionSpy,
    collection: (name: string): MongoCollectionHandle => {
      if (!createIndexSpies.has(name)) {
        createIndexSpies.set(
          name,
          vi.fn(
            async (
              spec: Record<string, unknown>,
              options: Record<string, unknown> = {},
            ) => {
              const indexName = String(options.name ?? 'unnamed');
              const existing = store.get(name) ?? [];
              const isText = Object.values(spec).some((v) => v === 'text');
              const weights = isText
                ? Object.fromEntries(
                    Object.entries(spec)
                      .filter(([, v]) => v === 'text')
                      .map(([k]) => [k, 1]),
                  )
                : undefined;

              existing.push({
                spec,
                doc: {
                  name: indexName,
                  key: isText ? { _fts: 'text', _ftsx: 1 } : spec,
                  ...(weights ? { weights } : {}),
                  ...(options.default_language
                    ? { default_language: options.default_language }
                    : {}),
                  ...(options.unique ? { unique: true } : {}),
                  ...(typeof options.expireAfterSeconds === 'number'
                    ? { expireAfterSeconds: options.expireAfterSeconds }
                    : {}),
                  ...(options.partialFilterExpression
                    ? { partialFilterExpression: options.partialFilterExpression }
                    : {}),
                },
              });
              store.set(name, existing);
              return indexName;
            },
          ),
        );
      }

      return {
        listIndexes: () => ({
          toArray: async () => (store.get(name) ?? []).map((entry) => entry.doc),
        }),
        createIndex: createIndexSpies.get(name) as MongoCollectionHandle['createIndex'],
      };
    },
  };

  return { db, store, createCollectionSpy, createIndexSpies, droppedCollections, droppedIndexes };
}

describe('database initialization service', () => {
  it('enforces explicit safeguards for production initialization', () => {
    expect(() =>
      assertSafeInitializationTarget({
        nodeEnv: 'production',
        confirmProduction: false,
        allowProductionEnv: false,
      }),
    ).toThrow(/production/i);

    expect(() =>
      assertSafeInitializationTarget({
        nodeEnv: 'production',
        confirmProduction: true,
        allowProductionEnv: false,
      }),
    ).toThrow(/production/i);

    expect(() =>
      assertSafeInitializationTarget({
        nodeEnv: 'production',
        confirmProduction: true,
        allowProductionEnv: true,
      }),
    ).not.toThrow();

    expect(() =>
      assertSafeInitializationTarget({
        nodeEnv: 'development',
        databaseName: 'mamladibe',
        dryRun: false,
        confirmProduction: false,
        allowProductionEnv: false,
      }),
    ).toThrow(/production/i);

    expect(() =>
      assertSafeInitializationTarget({
        nodeEnv: 'production',
        databaseName: 'mamladibe',
        dryRun: true,
        confirmProduction: false,
        allowProductionEnv: false,
      }),
    ).not.toThrow();
  });

  it('creates missing collections and indexes idempotently without dropping anything', async () => {
    const { db, createCollectionSpy } = createFakeMongoDb();

    const firstRun = await initializeDatabase(db, { nodeEnv: 'development' });
    expect(firstRun.totals.collectionsChecked).toBe(13);
    expect(firstRun.totals.collectionsCreated).toBe(13);
    expect(firstRun.totals.indexesCreated).toBe(31);
    expect(firstRun.hasConflicts).toBe(false);
    expect(createCollectionSpy).toHaveBeenCalledTimes(13);

    // Second run must be completely idempotent (0 collections/indexes created, all matching)
    const secondRun = await initializeDatabase(db, { nodeEnv: 'development' });
    expect(secondRun.totals.collectionsCreated).toBe(0);
    expect(secondRun.totals.collectionsExisting).toBe(13);
    expect(secondRun.totals.indexesCreated).toBe(0);
    expect(secondRun.totals.indexesMatching).toBe(31);
    expect(secondRun.totals.indexesDifferent).toBe(0);
    expect(secondRun.hasConflicts).toBe(false);
    expect(createCollectionSpy).toHaveBeenCalledTimes(13);
  });

  it('reports missing indexes in dry-run mode without mutating the database', async () => {
    const { db, store, createCollectionSpy } = createFakeMongoDb({
      [COLLECTIONS.SETTINGS]: [],
    });

    const dryReport = await initializeDatabase(db, {
      nodeEnv: 'development',
      dryRun: true,
    });

    expect(dryReport.dryRun).toBe(true);
    expect(dryReport.totals.indexesCreated).toBe(0);
    expect(dryReport.totals.indexesMissing).toBe(31);
    expect(createCollectionSpy).not.toHaveBeenCalled();
    expect(store.size).toBe(1);
  });

  it('detects and reports conflicting indexes and extra indexes without dropping them', async () => {
    const { db, store } = createFakeMongoDb({
      [COLLECTIONS.SETTINGS]: [
        {
          spec: { key: 1 },
          doc: {
            name: 'idx_settings_key_unique',
            key: { key: 1 },
            unique: false, // conflicts with unique: true
          },
        },
        {
          spec: { legacyField: 1 },
          doc: {
            name: 'idx_legacy',
            key: { legacyField: 1 },
          },
        },
      ],
    });

    const report = await initializeDatabase(db, { nodeEnv: 'development' });
    const settingsReport = report.collections.find(
      (c) => c.collection === COLLECTIONS.SETTINGS,
    );

    expect(report.hasConflicts).toBe(true);
    expect(settingsReport?.differentIndexes).toHaveLength(1);
    expect(settingsReport?.differentIndexes[0]?.reason).toMatch(/Unique flag differs/);
    expect(settingsReport?.extraIndexes).toEqual(['idx_legacy']);
    // Confirm conflicting and extra indexes were NEVER dropped
    expect(store.get(COLLECTIONS.SETTINGS)?.map((i) => i.doc.name)).toContain('idx_legacy');
  });
});

