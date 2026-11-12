import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, RATE } from '../../src/constants/index.js';
import {
  setTurnstileVerifierForTests,
  verifyTurnstileToken,
} from '../../src/lib/captcha.js';
import {
  reverseGeocodePoint,
  searchBangladeshPlaces,
  setGeocodingProviderForTests,
  type GeocodingProviderPort,
} from '../../src/lib/geocoding.js';
import {
  InMemoryRateLimitStore,
  acquireCommentCooldown,
  assertTrackNotLocked,
  claimTotpReplayWindow,
  clearPending2faSessionFailures,
  clearTrackFailures,
  consumeAdminLoginRateLimit,
  consumeGeoRateLimit,
  consumeIncidentCreateLimit,
  consumePending2faSessionFailure,
  recordCommentIpHit,
  recordTrackFailure,
  resetDevInMemoryRateLimitStore,
  setRateLimitStoreForTests,
} from '../../src/lib/ratelimit.js';
import {
  AbuseSignalModel,
  AdminUserModel,
  GeoCacheModel,
} from '../../src/models/index.js';
import {
  isIpRiskElevated,
  recordAbuseSignal,
} from '../../src/services/abuse-signal.service.js';
import { loginAdminWithPassword } from '../../src/services/admin-auth.service.js';

function createQueryChain<T>(value: T) {
  return {
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(value),
  };
}

describe('T01 & T02 ratelimit, captcha, and geocoding unit tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetDevInMemoryRateLimitStore();
    setRateLimitStoreForTests(new InMemoryRateLimitStore());
    setTurnstileVerifierForTests(null);
    setGeocodingProviderForTests(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    resetDevInMemoryRateLimitStore();
    setRateLimitStoreForTests(null);
    setTurnstileVerifierForTests(null);
    setGeocodingProviderForTests(null);
  });

  describe('ratelimit helpers', () => {
    it('enforces 5 incidents per 24h per actor and rejects the 6th', async () => {
      const actorId = 'a'.repeat(32);
      for (let i = 0; i < RATE.INCIDENTS_PER_ACTOR_24H; i += 1) {
        const res = await consumeIncidentCreateLimit(actorId);
        expect(res.allowed).toBe(true);
      }

      const sixth = await consumeIncidentCreateLimit(actorId);
      expect(sixth.allowed).toBe(false);
      expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('enforces single-use comment cooldown lock and TOTP replay window', async () => {
      const actorId = 'b'.repeat(32);
      const first = await acquireCommentCooldown(actorId);
      expect(first.allowed).toBe(true);

      const second = await acquireCommentCooldown(actorId);
      expect(second.allowed).toBe(false);
      expect(second.retryAfterSeconds).toBeGreaterThan(0);

      expect(await claimTotpReplayWindow('admin-1', '123456')).toBe(true);
      expect(await claimTotpReplayWindow('admin-1', '123456')).toBe(false);
    });

    it('tracks and clears per-session pending_2fa TOTP failures up to max threshold', async () => {
      const sessionId = 'session-pending-1';
      for (let i = 1; i < ADMIN.TOTP_SESSION_MAX_FAILS; i += 1) {
        const res = await consumePending2faSessionFailure(sessionId);
        expect(res.attempts).toBe(i);
        expect(res.exhausted).toBe(false);
      }

      const finalFail = await consumePending2faSessionFailure(sessionId);
      expect(finalFail.attempts).toBe(ADMIN.TOTP_SESSION_MAX_FAILS);
      expect(finalFail.exhausted).toBe(true);

      await clearPending2faSessionFailures(sessionId);
      const afterReset = await consumePending2faSessionFailure(sessionId);
      expect(afterReset.attempts).toBe(1);
      expect(afterReset.exhausted).toBe(false);
    });

    it('locks tracking after 5 wrong attempts and clears on valid login', async () => {
      const trackingId = 'MD-7K3Q9XTB';
      await expect(assertTrackNotLocked(trackingId)).resolves.toBeUndefined();

      for (let i = 1; i < RATE.TRACK_FAILS_BEFORE_LOCK; i += 1) {
        const step = await recordTrackFailure(trackingId);
        expect(step.lockedNow).toBe(false);
      }

      const lockStep = await recordTrackFailure(trackingId);
      expect(lockStep.lockedNow).toBe(true);
      expect(lockStep.attempts).toBe(RATE.TRACK_FAILS_BEFORE_LOCK);

      await expect(assertTrackNotLocked(trackingId)).rejects.toMatchObject({
        code: 'LOCKED',
        statusCode: 423,
      });

      setRateLimitStoreForTests(new InMemoryRateLimitStore());
      await recordTrackFailure('MD-CLEAR123');
      await clearTrackFailures('MD-CLEAR123');
      const afterClear = await recordTrackFailure('MD-CLEAR123');
      expect(afterClear.attempts).toBe(1);
    });

    it('fails closed (503) in production when Upstash credentials are missing', async () => {
      setRateLimitStoreForTests(null);
      process.env.NODE_ENV = 'production';
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      await expect(consumeGeoRateLimit('0'.repeat(32))).rejects.toMatchObject({
        code: 'INTERNAL',
        statusCode: 503,
      });
    });
  });

  describe('Turnstile verifier', () => {
    it('rejects empty tokens with 428 CAPTCHA_REQUIRED', async () => {
      await expect(verifyTurnstileToken('')).rejects.toMatchObject({
        code: 'CAPTCHA_REQUIRED',
        statusCode: 428,
      });
    });

    it('uses test verifier override cleanly and rejects false results with 428', async () => {
      setTurnstileVerifierForTests(async ({ token }) => token === 'ok-token');
      await expect(verifyTurnstileToken('ok-token', '127.0.0.1')).resolves.toBe(true);
      await expect(verifyTurnstileToken('bad-token', '127.0.0.1')).rejects.toMatchObject({
        code: 'CAPTCHA_REQUIRED',
        statusCode: 428,
      });
    });

    it('fails closed (503) when TURNSTILE_SECRET is unset or upstream fails', async () => {
      delete process.env.TURNSTILE_SECRET;
      await expect(verifyTurnstileToken('some-token')).rejects.toMatchObject({
        code: 'INTERNAL',
        statusCode: 503,
      });

      process.env.TURNSTILE_SECRET = 'dummy-turnstile-secret';
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'));
      await expect(verifyTurnstileToken('some-token')).rejects.toMatchObject({
        code: 'INTERNAL',
        statusCode: 503,
      });
    });

    it('rejects Cloudflare official testing secret in production (503 fail-closed)', async () => {
      process.env.NODE_ENV = 'production';
      process.env.TURNSTILE_SECRET = '1x0000000000000000000000000000000AA';
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      await expect(verifyTurnstileToken('some-token')).rejects.toMatchObject({
        code: 'INTERNAL',
        statusCode: 503,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('geocoding proxy and 30-day geo_cache', () => {
    it('returns cached reverse geocode without calling external providers', async () => {
      const findOneSpy = vi
        .spyOn(GeoCacheModel, 'findOne')
        .mockReturnValue(
          createQueryChain({
            result: {
              fallback: false,
              roadName: 'Mirpur Road',
              areaName: 'Dhanmondi',
              district: 'Dhaka',
            },
          }) as never,
        );

      const provider: GeocodingProviderPort = {
        reverseBarikoi: vi.fn(),
        reverseNominatim: vi.fn(),
        searchBarikoi: vi.fn(),
        searchNominatim: vi.fn(),
      };
      setGeocodingProviderForTests(provider);

      const result = await reverseGeocodePoint(23.7512, 90.3812);
      expect(findOneSpy).toHaveBeenCalledOnce();
      expect(provider.reverseBarikoi).not.toHaveBeenCalled();
      expect(provider.reverseNominatim).not.toHaveBeenCalled();
      expect(result).toEqual({
        fallback: false,
        roadName: 'Mirpur Road',
        areaName: 'Dhanmondi',
        district: 'Dhaka',
      });
    });

    it('falls back from Barikoi to Nominatim and caches the result', async () => {
      process.env.BARIKOI_API_KEY = 'barikoi-test-key';
      vi.spyOn(GeoCacheModel, 'findOne').mockReturnValue(createQueryChain(null) as never);
      const upsertSpy = vi
        .spyOn(GeoCacheModel, 'findOneAndUpdate')
        .mockResolvedValue({} as never);

      const provider: GeocodingProviderPort = {
        reverseBarikoi: vi.fn().mockRejectedValue(new Error('Barikoi down')),
        reverseNominatim: vi.fn().mockResolvedValue({
          fallback: false,
          areaName: 'Motijheel',
          district: 'Dhaka',
          displayName: 'Motijheel, Dhaka',
        }),
        searchBarikoi: vi.fn(),
        searchNominatim: vi.fn(),
      };
      setGeocodingProviderForTests(provider);

      const result = await reverseGeocodePoint(23.733, 90.417);
      expect(provider.reverseBarikoi).toHaveBeenCalledOnce();
      expect(provider.reverseNominatim).toHaveBeenCalledOnce();
      expect(upsertSpy).toHaveBeenCalledOnce();
      expect(result.fallback).toBe(false);
      expect(result.district).toBe('Dhaka');
    });

    it('degrades gracefully with fallback: true when both geocoders fail', async () => {
      delete process.env.BARIKOI_API_KEY;
      vi.spyOn(GeoCacheModel, 'findOne').mockReturnValue(createQueryChain(null) as never);

      setGeocodingProviderForTests({
        reverseBarikoi: vi.fn(),
        reverseNominatim: vi.fn().mockRejectedValue(new Error('Nominatim offline')),
        searchBarikoi: vi.fn(),
        searchNominatim: vi.fn().mockRejectedValue(new Error('Nominatim offline')),
      });

      const rev = await reverseGeocodePoint(23.81, 90.41);
      expect(rev).toEqual({ fallback: true });

      const search = await searchBangladeshPlaces('Gulshan');
      expect(search).toEqual({ fallback: true, items: [] });
    });
  });

  describe('Phase 2A security regression: raw IP rejection (BUG-SEC-4)', () => {
    it('rejects raw IPs and malformed identifiers before touching Redis rate-limit stores', async () => {
      const store = new InMemoryRateLimitStore();
      const slidingSpy = vi.spyOn(store, 'checkSlidingWindow');
      const incrSpy = vi.spyOn(store, 'incrementCounterWithTtl');
      setRateLimitStoreForTests(store);

      await expect(consumeGeoRateLimit('203.0.113.10')).rejects.toMatchObject({
        statusCode: 500,
      });
      await expect(consumeGeoRateLimit('::1')).rejects.toMatchObject({
        statusCode: 500,
      });
      await expect(consumeGeoRateLimit('iphash-1')).rejects.toMatchObject({
        statusCode: 500,
      });
      await expect(consumeAdminLoginRateLimit('198.51.100.5')).rejects.toMatchObject({
        statusCode: 500,
      });
      await expect(recordCommentIpHit('198.51.100.5')).rejects.toMatchObject({
        statusCode: 500,
      });

      expect(slidingSpy).not.toHaveBeenCalled();
      expect(incrSpy).not.toHaveBeenCalled();
    });

    it('rejects missing or raw IP hashes in abuse-signal and admin-auth services', async () => {
      const createSignalSpy = vi.spyOn(AbuseSignalModel, 'create');
      const countSignalSpy = vi.spyOn(AbuseSignalModel, 'countDocuments');
      const adminFindSpy = vi.spyOn(AdminUserModel, 'findOne');

      await expect(
        recordAbuseSignal({ ipHash: undefined, type: 'rate_limit_hit' }),
      ).rejects.toMatchObject({ statusCode: 500 });
      await expect(
        recordAbuseSignal({ ipHash: '203.0.113.10', type: 'rate_limit_hit' }),
      ).rejects.toMatchObject({ statusCode: 500 });
      await expect(isIpRiskElevated(undefined)).rejects.toMatchObject({
        statusCode: 500,
      });
      await expect(isIpRiskElevated('203.0.113.10')).rejects.toMatchObject({
        statusCode: 500,
      });
      await expect(
        loginAdminWithPassword('mod@mamladibe.org', 'AnyPassword!123', {}),
      ).rejects.toMatchObject({ statusCode: 500 });
      await expect(
        loginAdminWithPassword('mod@mamladibe.org', 'AnyPassword!123', {
          ipHash: '203.0.113.10',
        }),
      ).rejects.toMatchObject({ statusCode: 500 });

      expect(createSignalSpy).not.toHaveBeenCalled();
      expect(countSignalSpy).not.toHaveBeenCalled();
      expect(adminFindSpy).not.toHaveBeenCalled();
    });
  });
});
