import type { IndexDefinition, IndexOptions } from 'mongoose';
import {
  REGISTERED_COLLECTIONS,
  type RegisteredCollection,
} from '../models/index.js';

export interface MongoCollectionHandle {
  listIndexes(): { toArray(): Promise<Array<Record<string, unknown>>> };
  createIndex(
    indexSpec: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<string>;
}

export interface MongoDbHandle {
  databaseName: string;
  listCollections(
    filter?: Record<string, unknown>,
    options?: { nameOnly?: boolean },
  ): { toArray(): Promise<Array<{ name: string }>> };
  createCollection(name: string): Promise<unknown>;
  collection(name: string): MongoCollectionHandle;
}

export interface NormalizedIndexDescriptor {
  name: string;
  isText: boolean;
  keyEntries: Array<[string, number | string]>;
  textWeights?: Record<string, number>;
  defaultLanguage?: string;
  unique: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: string;
}

export interface IndexDifference {
  collection: string;
  indexName: string;
  existingName?: string;
  reason: string;
  expected: NormalizedIndexDescriptor;
  actual: NormalizedIndexDescriptor;
}

export interface CollectionInitReport {
  collection: string;
  modelName: string;
  collectionStatus: 'existing' | 'created' | 'would_create';
  declaredIndexCount: number;
  existingIndexNames: string[];
  createdIndexes: string[];
  missingIndexes: string[];
  matchingIndexes: string[];
  differentIndexes: IndexDifference[];
  extraIndexes: string[];
}

export interface DatabaseInitReport {
  databaseName: string;
  nodeEnv: 'development' | 'test' | 'production';
  dryRun: boolean;
  collections: CollectionInitReport[];
  totals: {
    collectionsChecked: number;
    collectionsCreated: number;
    collectionsExisting: number;
    indexesDeclared: number;
    indexesCreated: number;
    indexesMissing: number;
    indexesMatching: number;
    indexesDifferent: number;
    indexesExtra: number;
  };
  hasConflicts: boolean;
}

export interface ProductionGuardInput {
  nodeEnv: 'development' | 'test' | 'production';
  databaseName?: string;
  dryRun?: boolean;
  confirmProduction: boolean;
  allowProductionEnv: boolean;
}

export interface InitializeDatabaseOptions {
  nodeEnv: 'development' | 'test' | 'production';
  dryRun?: boolean;
  confirmProduction?: boolean;
  allowProductionEnv?: boolean;
  collections?: readonly RegisteredCollection[];
}

export function assertSafeInitializationTarget(
  input: ProductionGuardInput,
): void {
  if (input.dryRun === true) {
    return;
  }

  const isProductionTarget =
    input.nodeEnv === 'production' || input.databaseName === 'mamladibe';

  if (!isProductionTarget) {
    return;
  }

  if (!input.confirmProduction || !input.allowProductionEnv) {
    throw new Error(
      'Refusing to initialize a production database without explicit confirmation (--confirm-production and ALLOW_PRODUCTION_DB_INIT=true).',
    );
  }
}

function sortObjectDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectDeep);
  }

  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortObjectDeep(
        (value as Record<string, unknown>)[key],
      );
    }
    return sorted;
  }

  return value;
}

function canonicalizeFilter(filter: unknown): string | undefined {
  if (filter === null || filter === undefined || typeof filter !== 'object') {
    return undefined;
  }

  return JSON.stringify(sortObjectDeep(filter));
}

export function normalizeDeclaredIndex(
  fields: IndexDefinition,
  options: IndexOptions,
): NormalizedIndexDescriptor {
  const entries = Object.entries(fields);
  const name =
    typeof options.name === 'string' && options.name.length > 0
      ? options.name
      : entries.map(([field, dir]) => `${field}_${String(dir)}`).join('_');

  const isText = entries.some(([, dir]) => dir === 'text');
  const textWeights: Record<string, number> = {};

  if (isText) {
    const declaredWeights = options.weights ?? {};
    for (const [field, dir] of entries) {
      if (dir === 'text') {
        textWeights[field] =
          typeof declaredWeights[field] === 'number'
            ? declaredWeights[field]
            : 1;
      }
    }
  }

  return {
    name,
    isText,
    keyEntries: isText ? [] : entries.map(([k, v]) => [k, v]),
    ...(isText
      ? {
          textWeights: sortObjectDeep(textWeights) as Record<string, number>,
          defaultLanguage:
            typeof options.default_language === 'string'
              ? options.default_language
              : 'english',
        }
      : {}),
    unique: Boolean(options.unique),
    ...(typeof options.expireAfterSeconds === 'number'
      ? { expireAfterSeconds: options.expireAfterSeconds }
      : {}),
    ...(options.partialFilterExpression
      ? {
          partialFilterExpression: canonicalizeFilter(
            options.partialFilterExpression,
          ),
        }
      : {}),
  };
}

export function normalizeExistingIndex(
  raw: Record<string, unknown>,
): NormalizedIndexDescriptor {
  const name = typeof raw.name === 'string' ? raw.name : '';
  const rawKey =
    raw.key !== null && typeof raw.key === 'object'
      ? (raw.key as Record<string, number | string>)
      : {};
  const isText = rawKey._fts === 'text';

  const textWeights: Record<string, number> = {};
  if (isText && raw.weights !== null && typeof raw.weights === 'object') {
    for (const [field, weight] of Object.entries(
      raw.weights as Record<string, unknown>,
    )) {
      if (typeof weight === 'number') {
        textWeights[field] = weight;
      }
    }
  }

  return {
    name,
    isText,
    keyEntries: isText ? [] : Object.entries(rawKey),
    ...(isText
      ? {
          textWeights: sortObjectDeep(textWeights) as Record<string, number>,
          defaultLanguage:
            typeof raw.default_language === 'string'
              ? raw.default_language
              : 'english',
        }
      : {}),
    unique: Boolean(raw.unique),
    ...(typeof raw.expireAfterSeconds === 'number'
      ? { expireAfterSeconds: raw.expireAfterSeconds }
      : {}),
    ...(raw.partialFilterExpression
      ? {
          partialFilterExpression: canonicalizeFilter(
            raw.partialFilterExpression,
          ),
        }
      : {}),
  };
}

function sameKeyPattern(
  a: NormalizedIndexDescriptor,
  b: NormalizedIndexDescriptor,
): boolean {
  if (a.isText !== b.isText) {
    return false;
  }

  if (a.isText) {
    return (
      JSON.stringify(Object.keys(a.textWeights ?? {}).sort()) ===
      JSON.stringify(Object.keys(b.textWeights ?? {}).sort())
    );
  }

  return JSON.stringify(a.keyEntries) === JSON.stringify(b.keyEntries);
}

function diffDescriptors(
  expected: NormalizedIndexDescriptor,
  actual: NormalizedIndexDescriptor,
): string | null {
  if (!sameKeyPattern(expected, actual)) {
    return 'Index key pattern differs.';
  }

  if (expected.name !== actual.name) {
    return `Index shares key pattern with existing index "${actual.name}" instead of expected "${expected.name}".`;
  }

  if (expected.unique !== actual.unique) {
    return `Unique flag differs (expected ${String(expected.unique)}, found ${String(actual.unique)}).`;
  }

  if (expected.expireAfterSeconds !== actual.expireAfterSeconds) {
    return `TTL expireAfterSeconds differs (expected ${String(expected.expireAfterSeconds)}, found ${String(actual.expireAfterSeconds)}).`;
  }

  if (expected.isText) {
    if (expected.defaultLanguage !== actual.defaultLanguage) {
      return `Text index default_language differs (expected ${String(expected.defaultLanguage)}, found ${String(actual.defaultLanguage)}).`;
    }

    if (
      JSON.stringify(expected.textWeights) !== JSON.stringify(actual.textWeights)
    ) {
      return 'Text index weights differ.';
    }
  }

  if (expected.partialFilterExpression !== actual.partialFilterExpression) {
    return 'partialFilterExpression differs.';
  }

  return null;
}

function buildCreateIndexOptions(
  options: IndexOptions,
  name: string,
): Record<string, unknown> {
  const createOptions: Record<string, unknown> = { name };

  if (options.unique === true) {
    createOptions.unique = true;
  }

  if (typeof options.expireAfterSeconds === 'number') {
    createOptions.expireAfterSeconds = options.expireAfterSeconds;
  }

  if (typeof options.default_language === 'string') {
    createOptions.default_language = options.default_language;
  }

  if (options.partialFilterExpression !== undefined) {
    createOptions.partialFilterExpression = options.partialFilterExpression;
  }

  if (options.weights !== undefined) {
    createOptions.weights = options.weights;
  }

  return createOptions;
}

/**
 * Safely and idempotently initializes collections and create-only indexes.
 * Never drops collections, drops indexes, deletes data, or modifies documents.
 */
export async function initializeDatabase(
  db: MongoDbHandle,
  options: InitializeDatabaseOptions,
): Promise<DatabaseInitReport> {
  const dryRun = options.dryRun ?? false;
  const targetCollections = options.collections ?? REGISTERED_COLLECTIONS;

  assertSafeInitializationTarget({
    nodeEnv: options.nodeEnv,
    databaseName: db.databaseName,
    dryRun,
    confirmProduction: Boolean(options.confirmProduction),
    allowProductionEnv: Boolean(options.allowProductionEnv),
  });

  const existingCollectionDocs = await db
    .listCollections({}, { nameOnly: true })
    .toArray();
  const existingCollectionSet = new Set(
    existingCollectionDocs.map((entry) => entry.name),
  );

  const collectionReports: CollectionInitReport[] = [];

  for (const registered of targetCollections) {
    const existed = existingCollectionSet.has(registered.collectionName);
    let collectionStatus: CollectionInitReport['collectionStatus'] = 'existing';

    if (!existed) {
      if (dryRun) {
        collectionStatus = 'would_create';
      } else {
        await db.createCollection(registered.collectionName);
        collectionStatus = 'created';
      }
    }

    const collectionHandle = db.collection(registered.collectionName);
    const rawExistingIndexes =
      existed || !dryRun
        ? await collectionHandle.listIndexes().toArray()
        : [];

    const existingNormalized = rawExistingIndexes
      .map(normalizeExistingIndex)
      .filter((idx) => idx.name !== '_id_');

    const declaredRaw = registered.getDeclaredIndexes();
    const matchedExistingNames = new Set<string>();
    const createdIndexes: string[] = [];
    const missingIndexes: string[] = [];
    const matchingIndexes: string[] = [];
    const differentIndexes: IndexDifference[] = [];

    for (const [fields, indexOpts] of declaredRaw) {
      const expected = normalizeDeclaredIndex(fields, indexOpts);

      const byName = existingNormalized.find(
        (existing) => existing.name === expected.name,
      );
      const byKey = existingNormalized.find((existing) =>
        sameKeyPattern(expected, existing),
      );
      const matched = byName ?? byKey;

      if (!matched) {
        if (dryRun) {
          missingIndexes.push(expected.name);
        } else {
          await collectionHandle.createIndex(
            fields as Record<string, unknown>,
            buildCreateIndexOptions(indexOpts, expected.name),
          );
          createdIndexes.push(expected.name);
        }
        continue;
      }

      matchedExistingNames.add(matched.name);
      const differenceReason = diffDescriptors(expected, matched);

      if (differenceReason === null) {
        matchingIndexes.push(expected.name);
      } else {
        differentIndexes.push({
          collection: registered.collectionName,
          indexName: expected.name,
          existingName: matched.name,
          reason: differenceReason,
          expected,
          actual: matched,
        });
      }
    }

    const extraIndexes = existingNormalized
      .filter((existing) => !matchedExistingNames.has(existing.name))
      .map((existing) => existing.name);

    collectionReports.push({
      collection: registered.collectionName,
      modelName: registered.modelName,
      collectionStatus,
      declaredIndexCount: declaredRaw.length,
      existingIndexNames: rawExistingIndexes
        .map((idx) => (typeof idx.name === 'string' ? idx.name : ''))
        .filter((name) => name.length > 0),
      createdIndexes,
      missingIndexes,
      matchingIndexes,
      differentIndexes,
      extraIndexes,
    });
  }

  const totals = {
    collectionsChecked: collectionReports.length,
    collectionsCreated: collectionReports.filter(
      (c) => c.collectionStatus === 'created',
    ).length,
    collectionsExisting: collectionReports.filter(
      (c) => c.collectionStatus === 'existing',
    ).length,
    indexesDeclared: collectionReports.reduce(
      (sum, c) => sum + c.declaredIndexCount,
      0,
    ),
    indexesCreated: collectionReports.reduce(
      (sum, c) => sum + c.createdIndexes.length,
      0,
    ),
    indexesMissing: collectionReports.reduce(
      (sum, c) => sum + c.missingIndexes.length,
      0,
    ),
    indexesMatching: collectionReports.reduce(
      (sum, c) => sum + c.matchingIndexes.length,
      0,
    ),
    indexesDifferent: collectionReports.reduce(
      (sum, c) => sum + c.differentIndexes.length,
      0,
    ),
    indexesExtra: collectionReports.reduce(
      (sum, c) => sum + c.extraIndexes.length,
      0,
    ),
  };

  return {
    databaseName: db.databaseName,
    nodeEnv: options.nodeEnv,
    dryRun,
    collections: collectionReports,
    totals,
    hasConflicts: totals.indexesDifferent > 0,
  };
}

