import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, RATE, RETENTION } from '../../src/constants/index.js';
import { setTurnstileVerifierForTests } from '../../src/lib/captcha.js';
import { sha256Hex } from '../../src/lib/crypto.js';
import {
  addDays,
  getDailyQuotaExpiresAt,
  getDhakaDayKey,
  getNextDhakaMidnightUtc,
} from '../../src/lib/dhaka-time.js';
import {
  InMemoryRateLimitStore,
  acquireCommentCooldown,
  consumeFlagActionLimit,
  consumeVoteActionLimit,
  getCommentIpHitCount,
  getRemainingCommentCooldownSeconds,
  recordCommentIpHit,
  releaseCommentCooldown,
  setRateLimitStoreForTests,
} from '../../src/lib/ratelimit.js';
import {
  AbuseSignalModel,
  ActorModel,
  CommentModel,
  IncidentModel,
  SettingModel,
} from '../../src/models/index.js';
import { createComment } from '../../src/services/comment.service.js';
import {
  removeIncidentVote,
  reportComment,
  reportIncident,
  upsertIncidentVote,
} from '../../src/services/engagement.service.js';
import { internalError } from '../../src/utils/errors.js';

function leanChain<T>(value: T) {
  return {
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(value),
    }),
    lean: vi.fn().mockResolvedValue(value),
  };
}

describe('Phase 3B unit: comment cooldown, vote/flag sliding windows, Dhaka boundaries & fail-closed guards', () => {
  const actorA = sha256Hex('phase3b-unit-actor-a').slice(0, 32);
  const actorB = sha256Hex('phase3b-unit-actor-b').slice(0, 32);
  const ipHashA = sha256Hex('2026-11-11:198.51.100.10:secret').slice(0, 32);
  const ipHashB = sha256Hex('2026-11-11:198.51.100.11:secret').slice(0, 32);

  beforeEach(() => {
    setRateLimitStoreForTests(new InMemoryRateLimitStore());
    setTurnstileVerifierForTests(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setRateLimitStoreForTests(null);
    setTurnstileVerifierForTests(null);
  });

  it('tracks remaining 30-second comment cooldown, expires cleanly at 30s, and releases immediately', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T12:00:00.000Z'));

    expect(await getRemainingCommentCooldownSeconds(actorA)).toBe(0);

    const first = await acquireCommentCooldown(actorA);
    expect(first).toEqual({ allowed: true });

    const initialRemaining = await getRemainingCommentCooldownSeconds(actorA);
    expect(initialRemaining).toBe(RATE.COMMENT_COOLDOWN_SEC);

    // At +29 seconds, cooldown must still block (retryAfter >= 1) and actorB stays isolated
    vi.advanceTimersByTime(29_000);
    expect(await getRemainingCommentCooldownSeconds(actorA)).toBeGreaterThanOrEqual(1);
    const blockedAt29s = await acquireCommentCooldown(actorA);
    expect(blockedAt29s.allowed).toBe(false);
    expect(blockedAt29s.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(await getRemainingCommentCooldownSeconds(actorB)).toBe(0);

    // After full 30 seconds elapse, cooldown expires automatically
    vi.advanceTimersByTime(1_000);
    expect(await getRemainingCommentCooldownSeconds(actorA)).toBe(0);

    const reacquired = await acquireCommentCooldown(actorA);
    expect(reacquired).toEqual({ allowed: true });
    expect(await getRemainingCommentCooldownSeconds(actorA)).toBeGreaterThan(0);

    // Explicit release clears the lock immediately (used on concurrent 30->31 boundary CAPTCHA failure)
    await releaseCommentCooldown(actorA);
    expect(await getRemainingCommentCooldownSeconds(actorA)).toBe(0);
    expect(await acquireCommentCooldown(actorA)).toEqual({ allowed: true });
  });

  it('counts hashed-IP comment hits accurately up to 30 soft cap and rejects non-hex raw IPs', async () => {
    const now = new Date('2026-11-11T14:00:00.000Z');
    const nextUtcDay = new Date('2026-11-12T00:01:00.000Z');

    expect(await getCommentIpHitCount(ipHashA, now)).toBe(0);

    for (let i = 1; i <= RATE.COMMENTS_PER_IP_PER_DAY_SOFT; i += 1) {
      const hit = await recordCommentIpHit(ipHashA, now);
      expect(hit.count).toBe(i);
      expect(hit.softCapExceeded).toBe(false);
    }

    expect(await getCommentIpHitCount(ipHashA, now)).toBe(30);
    expect(await getCommentIpHitCount(ipHashB, now)).toBe(0);
    expect(await getCommentIpHitCount(ipHashA, nextUtcDay)).toBe(0);

    const overSoftCap = await recordCommentIpHit(ipHashA, now);
    expect(overSoftCap).toEqual({ count: 31, softCapExceeded: true });
    expect(await getCommentIpHitCount(ipHashA, now)).toBe(31);

    await expect(getCommentIpHitCount('203.0.113.55', now)).rejects.toMatchObject({
      statusCode: 500,
    });
    await expect(recordCommentIpHit('203.0.113.55', now)).rejects.toMatchObject({
      statusCode: 500,
    });
  });

  it('enforces 30 vote actions per hour per actor and resets after 1 hour', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T09:00:00.000Z'));

    for (let i = 0; i < RATE.VOTE_ACTIONS_PER_ACTOR_PER_HOUR; i += 1) {
      await expect(consumeVoteActionLimit(actorA)).resolves.toBeUndefined();
    }

    await expect(consumeVoteActionLimit(actorA)).rejects.toMatchObject({
      statusCode: 429,
      code: ERROR_CODES.RATE_LIMITED,
    });

    // Separate actor retains independent vote quota
    await expect(consumeVoteActionLimit(actorB)).resolves.toBeUndefined();

    // Advance 59m59s: still blocked
    vi.advanceTimersByTime(60 * 60 * 1000 - 1_000);
    await expect(consumeVoteActionLimit(actorA)).rejects.toMatchObject({
      statusCode: 429,
      code: ERROR_CODES.RATE_LIMITED,
    });

    // Past 1 hour sliding window: allowed again
    vi.advanceTimersByTime(1_001);
    await expect(consumeVoteActionLimit(actorA)).resolves.toBeUndefined();
  });

  it('enforces 20 flag actions per 24 hours per actor and resets after 24 hours', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T08:00:00.000Z'));

    for (let i = 0; i < RATE.FLAG_ACTIONS_PER_ACTOR_PER_DAY; i += 1) {
      await expect(consumeFlagActionLimit(actorA)).resolves.toBeUndefined();
    }

    await expect(consumeFlagActionLimit(actorA)).rejects.toMatchObject({
      statusCode: 429,
      code: ERROR_CODES.RATE_LIMITED,
    });

    await expect(consumeFlagActionLimit(actorB)).resolves.toBeUndefined();

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    await expect(consumeFlagActionLimit(actorA)).resolves.toBeUndefined();
  });

  it('fails closed with 503 when rate-limit store fails on comment cooldown, IP lookup, vote, or flag helpers', async () => {
    const brokenStore = new InMemoryRateLimitStore();
    vi.spyOn(brokenStore, 'getTtlSeconds').mockRejectedValue(new Error('Redis down'));
    vi.spyOn(brokenStore, 'deleteKey').mockRejectedValue(new Error('Redis down'));
    vi.spyOn(brokenStore, 'getNumber').mockRejectedValue(new Error('Redis down'));
    vi.spyOn(brokenStore, 'checkSlidingWindow').mockRejectedValue(new Error('Redis down'));
    setRateLimitStoreForTests(brokenStore);

    await expect(getRemainingCommentCooldownSeconds(actorA)).rejects.toMatchObject({
      statusCode: 503,
    });
    await expect(releaseCommentCooldown(actorA)).rejects.toMatchObject({
      statusCode: 503,
    });
    await expect(getCommentIpHitCount(ipHashA)).rejects.toMatchObject({
      statusCode: 503,
    });
    await expect(consumeVoteActionLimit(actorA)).rejects.toMatchObject({
      statusCode: 503,
    });
    await expect(consumeFlagActionLimit(actorA)).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('computes Asia/Dhaka calendar day rollover cleanly across UTC+6 midnight', () => {
    // 2026-11-11T17:59:59.999Z === 2026-11-11 23:59:59.999 Asia/Dhaka
    const beforeDhakaMidnight = new Date('2026-11-11T17:59:59.999Z');
    // 2026-11-11T18:00:00.000Z === 2026-11-12 00:00:00.000 Asia/Dhaka
    const atDhakaMidnight = new Date('2026-11-11T18:00:00.000Z');

    expect(getDhakaDayKey(beforeDhakaMidnight)).toBe('2026-11-11');
    expect(getNextDhakaMidnightUtc(beforeDhakaMidnight).toISOString()).toBe(
      '2026-11-11T18:00:00.000Z',
    );
    expect(getDailyQuotaExpiresAt(beforeDhakaMidnight).toISOString()).toBe(
      addDays(beforeDhakaMidnight, RETENTION.QUOTA_DOC_DAYS).toISOString(),
    );

    expect(getDhakaDayKey(atDhakaMidnight)).toBe('2026-11-12');
    expect(getNextDhakaMidnightUtc(atDhakaMidnight).toISOString()).toBe(
      '2026-11-12T18:00:00.000Z',
    );
    expect(getDailyQuotaExpiresAt(atDhakaMidnight).toISOString()).toBe(
      addDays(atDhakaMidnight, RETENTION.QUOTA_DOC_DAYS).toISOString(),
    );
  });

  it('rejects missing or raw-IP ipHash fail-closed across engagement and comment services', async () => {
    await expect(
      upsertIncidentVote('MD-AAAAAAAA', actorA, 'support', undefined),
    ).rejects.toMatchObject({ statusCode: 500, code: ERROR_CODES.INTERNAL });
    await expect(
      upsertIncidentVote('MD-AAAAAAAA', actorA, 'support', '198.51.100.77'),
    ).rejects.toMatchObject({ statusCode: 500, code: ERROR_CODES.INTERNAL });

    await expect(
      removeIncidentVote('MD-AAAAAAAA', actorA, undefined),
    ).rejects.toMatchObject({ statusCode: 500, code: ERROR_CODES.INTERNAL });
    await expect(
      removeIncidentVote('MD-AAAAAAAA', actorA, '198.51.100.77'),
    ).rejects.toMatchObject({ statusCode: 500, code: ERROR_CODES.INTERNAL });

    await expect(
      reportIncident('MD-AAAAAAAA', actorA, { reason: 'spam' }, undefined),
    ).rejects.toMatchObject({ statusCode: 500, code: ERROR_CODES.INTERNAL });
    await expect(
      reportIncident('MD-AAAAAAAA', actorA, { reason: 'spam' }, '198.51.100.77'),
    ).rejects.toMatchObject({ statusCode: 500, code: ERROR_CODES.INTERNAL });

    await expect(
      reportComment(new Types.ObjectId().toHexString(), actorA, { reason: 'spam' }, undefined),
    ).rejects.toMatchObject({ statusCode: 500, code: ERROR_CODES.INTERNAL });
    await expect(
      createComment(
        'MD-AAAAAAAA',
        { type: 'info', body: 'Valid body length here' },
        { actorId: actorA, ipHash: '198.51.100.77' },
      ),
    ).rejects.toMatchObject({ statusCode: 500, code: ERROR_CODES.INTERNAL });
  });

  it('does not persist rate_limit_hit or captcha_failed abuse signals on 503 infrastructure outages', async () => {
    const incidentObjectId = new Types.ObjectId();
    const commentObjectId = new Types.ObjectId();

    vi.spyOn(IncidentModel, 'findOne').mockReturnValue(
      leanChain({ _id: incidentObjectId }) as never,
    );
    vi.spyOn(IncidentModel, 'exists').mockResolvedValue({ _id: incidentObjectId } as never);
    vi.spyOn(CommentModel, 'findOne').mockReturnValue(
      leanChain({ _id: commentObjectId, incidentId: incidentObjectId }) as never,
    );
    vi.spyOn(ActorModel, 'findOneAndUpdate').mockReturnValue(
      leanChain({ actorId: actorA }) as never,
    );
    vi.spyOn(SettingModel, 'find').mockReturnValue(leanChain([]) as never);
    const abuseCreateSpy = vi.spyOn(AbuseSignalModel, 'create').mockResolvedValue({} as never);

    // 1. Redis 503 during vote/flag action limit check must NOT log 'rate_limit_hit'
    const brokenStore = new InMemoryRateLimitStore();
    vi.spyOn(brokenStore, 'checkSlidingWindow').mockRejectedValue(new Error('Redis outage'));
    setRateLimitStoreForTests(brokenStore);

    await expect(
      upsertIncidentVote('MD-AAAAAAAA', actorA, 'support', ipHashA),
    ).rejects.toMatchObject({ statusCode: 503 });
    await expect(
      reportIncident('MD-AAAAAAAA', actorA, { reason: 'spam' }, ipHashA),
    ).rejects.toMatchObject({ statusCode: 503 });
    await expect(
      reportComment(commentObjectId.toHexString(), actorA, { reason: 'spam' }, ipHashA),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(abuseCreateSpy).not.toHaveBeenCalled();

    // 2. Turnstile 503 outage during comment CAPTCHA challenge must NOT log 'captcha_failed'
    const workingStore = new InMemoryRateLimitStore();
    setRateLimitStoreForTests(workingStore);
    for (let i = 0; i < RATE.COMMENTS_PER_IP_PER_DAY_SOFT; i += 1) {
      await recordCommentIpHit(ipHashA);
    }
    vi.spyOn(AbuseSignalModel, 'countDocuments').mockResolvedValue(0);
    setTurnstileVerifierForTests(async () => {
      throw internalError('Turnstile unavailable', 503);
    });

    await expect(
      createComment(
        'MD-AAAAAAAA',
        { type: 'info', body: 'Valid body during turnstile outage', captchaToken: 'tok' },
        { actorId: actorA, ipHash: ipHashA },
      ),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(abuseCreateSpy).not.toHaveBeenCalled();
    expect(await getRemainingCommentCooldownSeconds(actorA)).toBe(0);
  });
});
