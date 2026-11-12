import { describe, expect, it } from 'vitest';
import { COLLECTIONS, TTL_SECONDS } from '../../src/constants/index.js';
import { REGISTERED_COLLECTIONS } from '../../src/models/index.js';

function getIndexesFor(collectionName: string) {
  const entry = REGISTERED_COLLECTIONS.find(
    (item) => item.collectionName === collectionName,
  );
  if (!entry) {
    throw new Error(`Collection ${collectionName} is not registered.`);
  }
  return entry.getDeclaredIndexes();
}

describe('MongoDB index definitions', () => {
  it('defines explicit names on every declared index across all 13 collections', () => {
    for (const entry of REGISTERED_COLLECTIONS) {
      const indexes = entry.getDeclaredIndexes();
      for (const [, options] of indexes) {
        expect(typeof options.name).toBe('string');
        expect((options.name ?? '').length).toBeGreaterThan(0);
      }
    }
  });

  it('includes all 28 confirmed PRD indexes documented in Database.md §7.1 plus PRD §8 purgeAt/audit_logs indexes', () => {
    const counts = Object.fromEntries(
      REGISTERED_COLLECTIONS.map((entry) => [
        entry.collectionName,
        entry.getDeclaredIndexes().length,
      ]),
    );

    expect(counts).toEqual({
      [COLLECTIONS.INCIDENTS]: 8, // 7 from Database.md §7.1 + purgeAt partial TTL from PRD §8.1
      [COLLECTIONS.INCIDENT_VERSIONS]: 1,
      [COLLECTIONS.COMMENTS]: 3, // 2 from Database.md §7.1 + purgeAt partial TTL from PRD §8.3
      [COLLECTIONS.VOTES]: 2, // proposed #29 omitted
      [COLLECTIONS.REPORTS]: 2, // proposed #30 omitted
      [COLLECTIONS.DAILY_QUOTAS]: 2,
      [COLLECTIONS.ACTORS]: 2,
      [COLLECTIONS.ABUSE_SIGNALS]: 2,
      [COLLECTIONS.GEO_CACHE]: 2,
      [COLLECTIONS.ADMIN_USERS]: 1,
      [COLLECTIONS.ADMIN_SESSIONS]: 2,
      [COLLECTIONS.AUDIT_LOGS]: 3, // 2 from Database.md §7.1 + createdAt desc from PRD §8.12
      [COLLECTIONS.SETTINGS]: 1,
    });
  });

  it('defines all required unique indexes', () => {
    const findUnique = (collection: string, name: string) =>
      getIndexesFor(collection).find(([, opts]) => opts.name === name);

    expect(findUnique(COLLECTIONS.INCIDENTS, 'idx_incidents_trackingId_unique')?.[1].unique).toBe(true);
    expect(findUnique(COLLECTIONS.INCIDENT_VERSIONS, 'idx_incident_versions_incidentId_version_unique')?.[1].unique).toBe(true);
    expect(findUnique(COLLECTIONS.VOTES, 'idx_votes_incidentId_actorId_unique')?.[1].unique).toBe(true);
    expect(findUnique(COLLECTIONS.REPORTS, 'idx_reports_targetType_targetId_actorId_unique')?.[1].unique).toBe(true);
    expect(findUnique(COLLECTIONS.DAILY_QUOTAS, 'idx_daily_quotas_actorId_day_kind_unique')?.[1].unique).toBe(true);
    expect(findUnique(COLLECTIONS.ACTORS, 'idx_actors_actorId_unique')?.[1].unique).toBe(true);
    expect(findUnique(COLLECTIONS.GEO_CACHE, 'idx_geo_cache_key_unique')?.[1].unique).toBe(true);
    expect(findUnique(COLLECTIONS.ADMIN_USERS, 'idx_admin_users_email_unique')?.[1].unique).toBe(true);
    expect(findUnique(COLLECTIONS.ADMIN_SESSIONS, 'idx_admin_sessions_sessionHash_unique')?.[1].unique).toBe(true);
    expect(findUnique(COLLECTIONS.SETTINGS, 'idx_settings_key_unique')?.[1].unique).toBe(true);
  });

  it('defines the 2dsphere geospatial index and default_language: none text index on incidents', () => {
    const incidentIndexes = getIndexesFor(COLLECTIONS.INCIDENTS);

    const geoIndex = incidentIndexes.find(
      ([, opts]) => opts.name === 'idx_incidents_location_2dsphere',
    );
    expect(geoIndex?.[0]).toEqual({ location: '2dsphere' });

    const textIndex = incidentIndexes.find(
      ([, opts]) => opts.name === 'idx_incidents_text_search',
    );
    expect(textIndex?.[0]).toEqual({
      title: 'text',
      description: 'text',
      roadName: 'text',
      areaName: 'text',
    });
    expect(textIndex?.[1].default_language).toBe('none');
  });

  it('defines all required TTL indexes with exact expireAfterSeconds values', () => {
    const quotaTtl = getIndexesFor(COLLECTIONS.DAILY_QUOTAS).find(
      ([, opts]) => opts.name === 'idx_daily_quotas_expiresAt_ttl',
    );
    expect(quotaTtl?.[1].expireAfterSeconds).toBe(0);

    const abuseTtl = getIndexesFor(COLLECTIONS.ABUSE_SIGNALS).find(
      ([, opts]) => opts.name === 'idx_abuse_signals_createdAt_ttl',
    );
    expect(abuseTtl?.[1].expireAfterSeconds).toBe(TTL_SECONDS.ABUSE_SIGNALS);
    expect(abuseTtl?.[1].expireAfterSeconds).toBe(604800);

    const geoTtl = getIndexesFor(COLLECTIONS.GEO_CACHE).find(
      ([, opts]) => opts.name === 'idx_geo_cache_createdAt_ttl',
    );
    expect(geoTtl?.[1].expireAfterSeconds).toBe(TTL_SECONDS.GEO_CACHE);
    expect(geoTtl?.[1].expireAfterSeconds).toBe(2592000);

    const sessionTtl = getIndexesFor(COLLECTIONS.ADMIN_SESSIONS).find(
      ([, opts]) => opts.name === 'idx_admin_sessions_expiresAt_ttl',
    );
    expect(sessionTtl?.[1].expireAfterSeconds).toBe(0);

    const incidentPurgeTtl = getIndexesFor(COLLECTIONS.INCIDENTS).find(
      ([, opts]) => opts.name === 'idx_incidents_purgeAt_ttl',
    );
    expect(incidentPurgeTtl?.[1].expireAfterSeconds).toBe(0);
    expect(incidentPurgeTtl?.[1].partialFilterExpression).toEqual({
      purgeAt: { $exists: true },
    });

    const commentPurgeTtl = getIndexesFor(COLLECTIONS.COMMENTS).find(
      ([, opts]) => opts.name === 'idx_comments_purgeAt_ttl',
    );
    expect(commentPurgeTtl?.[1].expireAfterSeconds).toBe(0);
    expect(commentPurgeTtl?.[1].partialFilterExpression).toEqual({
      purgeAt: { $exists: true },
    });
  });

  it('preserves exact compound index field order and excludes the two PROPOSED indexes', () => {
    const reportIndexes = getIndexesFor(COLLECTIONS.REPORTS);
    const reportUnique = reportIndexes.find(
      ([, opts]) => opts.name === 'idx_reports_targetType_targetId_actorId_unique',
    );
    expect(Object.keys(reportUnique?.[0] ?? {})).toEqual([
      'targetType',
      'targetId',
      'actorId',
    ]);
    expect(
      reportIndexes.some(([fields]) => Object.keys(fields)[0] === 'actorId'),
    ).toBe(false);

    const voteIndexes = getIndexesFor(COLLECTIONS.VOTES);
    expect(
      voteIndexes.some(([fields]) => Object.keys(fields)[0] === 'actorId'),
    ).toBe(false);

    const commentList = getIndexesFor(COLLECTIONS.COMMENTS).find(
      ([, opts]) => opts.name === 'idx_comments_incidentId_status_createdAt',
    );
    expect(Object.entries(commentList?.[0] ?? {})).toEqual([
      ['incidentId', 1],
      ['status', 1],
      ['createdAt', -1],
    ]);
  });
});

