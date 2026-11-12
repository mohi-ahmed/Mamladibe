import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, RATE } from '../../src/constants/index.js';
import { decodeCursor, encodeCursor } from '../../src/lib/cursor.js';
import { computeChangeRatio, levenshteinDistance } from '../../src/lib/levenshtein.js';
import {
  InMemoryRateLimitStore,
  assertTrackNotLocked,
  clearTrackFailures,
  recordTrackFailure,
  setRateLimitStoreForTests,
} from '../../src/lib/ratelimit.js';
import {
  computeIncidentContentHash,
  normalizeContentText,
} from '../../src/lib/text-rules.js';
import {
  generateReporterSecret,
  normalizeReporterSecret,
  verifyReporterSecret,
} from '../../src/lib/tracking.js';
import { listPublicIncidents } from '../../src/services/incident.service.js';
import { roundCoordinate } from '../../src/utils/geo.js';
import { listIncidentsQuerySchema } from '../../src/validators/public.validator.js';

describe('Phase 3C unit: tracking secrets, lockout TTL, 30% Levenshtein, cursors, query validation & contentHash', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeEach(() => {
    setRateLimitStoreForTests(new InMemoryRateLimitStore());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setRateLimitStoreForTests(null);
    process.env.NODE_ENV = originalNodeEnv;
    if (originalRedisUrl === undefined) {
      delete process.env.UPSTASH_REDIS_REST_URL;
    } else {
      process.env.UPSTASH_REDIS_REST_URL = originalRedisUrl;
    }
    if (originalRedisToken === undefined) {
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
    } else {
      process.env.UPSTASH_REDIS_REST_TOKEN = originalRedisToken;
    }
  });

  it('normalizes Crockford secrets (case, spaces/hyphens, I/L->1, O->0) and verifies safely', () => {
    const { rawSecret, formattedSecret, secretHash } = generateReporterSecret();

    expect(rawSecret).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(formattedSecret).toMatch(
      /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}-[0-9A-HJKMNP-TV-Z]$/,
    );

    const typoVariant = formattedSecret
      .toLowerCase()
      .replace(/1/g, 'l')
      .replace(/0/g, 'o')
      .replace(/-/g, ' ');

    expect(normalizeReporterSecret(typoVariant)).toBe(rawSecret);
    expect(verifyReporterSecret(typoVariant, secretHash)).toBe(true);

    // Flip last character -> rejected safely
    const lastChar = rawSecret[rawSecret.length - 1] === 'Z' ? '2' : 'Z';
    const wrongSecret = `${rawSecret.slice(0, -1)}${lastChar}`;
    expect(verifyReporterSecret(wrongSecret, secretHash)).toBe(false);
    expect(verifyReporterSecret('short', secretHash)).toBe(false);
    expect(verifyReporterSecret(`${rawSecret}AAAA`, secretHash)).toBe(false);
  });

  it('locks tracking after 5 failures, auto-unlocks after 15 minutes, resets on clear, and fails closed in prod', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T10:00:00.000Z'));

    const trackingId = 'MD-7K3Q9XTB';
    for (let i = 1; i < RATE.TRACK_FAILS_BEFORE_LOCK; i += 1) {
      const step = await recordTrackFailure(trackingId);
      expect(step).toEqual({ lockedNow: false, attempts: i });
      await expect(assertTrackNotLocked(trackingId)).resolves.toBeUndefined();
    }

    const lockedStep = await recordTrackFailure(trackingId);
    expect(lockedStep).toEqual({
      lockedNow: true,
      attempts: RATE.TRACK_FAILS_BEFORE_LOCK,
      retryAfterSeconds: RATE.TRACK_LOCK_MINUTES * 60,
    });

    await expect(assertTrackNotLocked(trackingId)).rejects.toMatchObject({
      code: ERROR_CODES.LOCKED,
      statusCode: 423,
      details: {
        retryAfterSeconds: RATE.TRACK_LOCK_MINUTES * 60,
      },
    });

    // At 14m59s still locked; at 15m00s lock TTL expires
    vi.advanceTimersByTime((RATE.TRACK_LOCK_MINUTES * 60 - 1) * 1000);
    await expect(assertTrackNotLocked(trackingId)).rejects.toMatchObject({
      code: ERROR_CODES.LOCKED,
      statusCode: 423,
    });

    vi.advanceTimersByTime(1000);
    await expect(assertTrackNotLocked(trackingId)).resolves.toBeUndefined();

    // Clearing failure count resets attempts cleanly
    await recordTrackFailure(trackingId);
    await recordTrackFailure(trackingId);
    await clearTrackFailures(trackingId);
    const restarted = await recordTrackFailure(trackingId);
    expect(restarted.attempts).toBe(1);

    // Fail-closed (503) in production without Redis credentials
    setRateLimitStoreForTests(null);
    process.env.NODE_ENV = 'production';
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    await expect(assertTrackNotLocked(trackingId)).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL,
      statusCode: 503,
    });
  });

  it('computes Unicode-safe Levenshtein ratio at 30% boundary across English, Bangla ZWJ/ZWNJ, and safetyTip edge cases', () => {
    expect(computeChangeRatio('abcdefghij', 'abcdefgXYZ')).toBeCloseTo(0.3, 10);
    expect(computeChangeRatio('abcdefghij', 'abcdefWXYZ')).toBeCloseTo(0.4, 10);

    // Bangla with ZWJ (U+200D) / ZWNJ (U+200C): 10 code points, 3 replaced => exact 0.30
    const bnOld = 'ক\u200Dখ\u200Cগঘঙচছজ';
    expect(Array.from(bnOld)).toHaveLength(10);
    const bn30 = 'ক\u200Dখ\u200Cগঘঙটঠড';
    expect(levenshteinDistance(bnOld, bn30)).toBe(3);
    expect(computeChangeRatio(bnOld, bn30)).toBeCloseTo(0.3, 10);

    // PRD §9.6: ratio = levenshtein(old, new) / max(old.length, 1)
    expect(computeChangeRatio('Avoid right lane', '')).toBe(1);
    expect(computeChangeRatio('', 'New safety tip')).toBe(14);
    expect(computeChangeRatio('', '')).toBe(0);
  });

  it('produces identical contentHash across create/quick-edit normalization and preserves Bangla ZWJ/ZWNJ', () => {
    const rawTitle = '  র\u200D্যাপিড সতর্কতা\u202E  ';
    const rawDesc = 'একটি গুরুত্বপূর্ণ\u200C তথ্য\r\n\r\n\r\nএখানে দেওয়া হলো।  ';

    const cleanTitle = normalizeContentText(rawTitle);
    const cleanDesc = normalizeContentText(rawDesc);

    expect(cleanTitle).toContain('\u200D');
    expect(cleanTitle).not.toContain('\u202E');
    expect(cleanDesc).toContain('\u200C');
    expect(cleanDesc).not.toContain('\r\n');
    expect(cleanDesc).not.toContain('\n\n\n');

    expect(computeIncidentContentHash({ title: rawTitle, description: rawDesc })).toBe(
      computeIncidentContentHash({ title: cleanTitle, description: cleanDesc }),
    );
  });

  it('encodes/decodes valid cursors and rejects malformed/12-char-ObjectId cursors with 400 VALIDATION_ERROR', () => {
    const date = new Date('2026-11-11T09:15:30.123Z');
    const id = new Types.ObjectId('6731a0c2f1d2a3b4c5d6e7f8');
    const cursor = encodeCursor(date, id);

    const decoded = decodeCursor(cursor);
    expect(decoded.createdAt.toISOString()).toBe(date.toISOString());
    expect(decoded.id.toString()).toBe(id.toString());

    const encodeJson = (obj: unknown) =>
      Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');

    const badCursors = [
      'not-base64url!!!',
      encodeJson(null),
      encodeJson([1, 2]),
      encodeJson({ c: date.toISOString(), i: '123456789012' }), // 12-char non-hex BSON trap
      encodeJson({ c: 'not-a-date', i: id.toString() }),
      encodeJson({ c: date.toISOString() }),
    ];

    for (const bad of badCursors) {
      expect(() => decodeCursor(bad)).toThrowError(/Invalid pagination cursor/);
    }
  });

  it('validates bbox/near CSV empty segments, rejects cursor with sort=nearest, and rounds coordinates to 5 decimals', async () => {
    expect(roundCoordinate(23.8103349)).toBe(23.81033);

    expect(
      listIncidentsQuerySchema.safeParse({ bbox: '90.30,,90.50,23.95' }).success,
    ).toBe(false);
    expect(
      listIncidentsQuerySchema.safeParse({ bbox: ',23.70,90.50,23.95' }).success,
    ).toBe(false);
    expect(
      listIncidentsQuerySchema.safeParse({ bbox: '90.50,23.70,90.30,23.95' }).success,
    ).toBe(false);
    expect(
      listIncidentsQuerySchema.safeParse({ near: '23.81,' }).success,
    ).toBe(false);
    expect(
      listIncidentsQuerySchema.safeParse({ near: '10.0,90.4' }).success,
    ).toBe(false);
    expect(
      listIncidentsQuerySchema.safeParse({
        near: '23.8103,90.4125',
        sort: 'nearest',
        cursor: 'abc',
      }).success,
    ).toBe(false);

    expect(
      listIncidentsQuerySchema.safeParse({
        bbox: '90.30, 23.70, 90.50, 23.95',
        limit: '500',
      }).success,
    ).toBe(true);

    const catAlias = listIncidentsQuerySchema.safeParse({
      cat: 'road_accident,infrastructure',
    });
    expect(catAlias.success).toBe(true);
    if (catAlias.success) {
      expect(catAlias.data.category).toBe('road_accident,infrastructure');
    }

    expect(
      listIncidentsQuerySchema.safeParse({
        category: 'road_accident',
        cat: 'infrastructure',
      }).success,
    ).toBe(false);

    await expect(
      listPublicIncidents({
        near: '23.8103,90.4125',
        sort: 'nearest',
        cursor: 'abc',
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      statusCode: 400,
    });
  });
});

