import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RATE } from '../../src/constants/index.js';
import { sha256Hex } from '../../src/lib/crypto.js';
import {
  InMemoryRateLimitStore,
  acquireIncidentDuplicateLock,
  consumeIncidentCreateLimit,
  releaseIncidentDuplicateLock,
  setRateLimitStoreForTests,
} from '../../src/lib/ratelimit.js';

describe('Phase 3A unit: rolling 24h incident quota & atomic duplicate lock', () => {
  beforeEach(() => {
    setRateLimitStoreForTests(new InMemoryRateLimitStore());
  });

  afterEach(() => {
    vi.useRealTimers();
    setRateLimitStoreForTests(null);
  });

  it('enforces rolling 5-per-24h actor quota and replenishes after 24h elapses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T10:00:00.000Z'));

    const actorA = sha256Hex('actor-a-seed');
    const actorB = sha256Hex('actor-b-seed');

    for (let i = 0; i < RATE.INCIDENTS_PER_ACTOR_24H; i += 1) {
      const res = await consumeIncidentCreateLimit(actorA);
      expect(res.allowed).toBe(true);
    }

    const blocked = await consumeIncidentCreateLimit(actorA);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    // Separate actor retains an independent 24h quota
    const otherActor = await consumeIncidentCreateLimit(actorB);
    expect(otherActor.allowed).toBe(true);

    // Just before 24h expires, actorA is still blocked
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 5000);
    const stillBlocked = await consumeIncidentCreateLimit(actorA);
    expect(stillBlocked.allowed).toBe(false);

    // Once 24h rolling window expires, actorA can submit again
    vi.advanceTimersByTime(10_000);
    const unlocked = await consumeIncidentCreateLimit(actorA);
    expect(unlocked.allowed).toBe(true);
  });

  it('grants atomic duplicate lock to only one concurrent caller and releases cleanly', async () => {
    const actorA = sha256Hex('actor-concurrent-a');
    const actorB = sha256Hex('actor-concurrent-b');
    const contentHash = sha256Hex('normalized title\nnormalized description');

    const lockResults = await Promise.all(
      Array.from({ length: 5 }, () => acquireIncidentDuplicateLock(actorA, contentHash)),
    );
    expect(lockResults.filter(Boolean)).toHaveLength(1);
    expect(lockResults.filter((v) => !v)).toHaveLength(4);

    // Different actor with identical contentHash is not blocked
    expect(await acquireIncidentDuplicateLock(actorB, contentHash)).toBe(true);

    // Releasing lets the same actor re-acquire after a failed persistence attempt
    await releaseIncidentDuplicateLock(actorA, contentHash);
    expect(await acquireIncidentDuplicateLock(actorA, contentHash)).toBe(true);
  });

  it('fails closed with 503 when rate-limit store fails during quota or dedup operations', async () => {
    const brokenStore = new InMemoryRateLimitStore();
    vi.spyOn(brokenStore, 'checkSlidingWindow').mockRejectedValue(
      new Error('Redis connection reset'),
    );
    vi.spyOn(brokenStore, 'acquireOnceLock').mockRejectedValue(
      new Error('Redis connection reset'),
    );
    vi.spyOn(brokenStore, 'deleteKey').mockRejectedValue(new Error('Redis connection reset'));
    setRateLimitStoreForTests(brokenStore);

    const actor = sha256Hex('actor-fail-closed');
    const contentHash = sha256Hex('title\ndescription');

    await expect(consumeIncidentCreateLimit(actor)).rejects.toMatchObject({
      statusCode: 503,
    });
    await expect(acquireIncidentDuplicateLock(actor, contentHash)).rejects.toMatchObject({
      statusCode: 503,
    });
    await expect(releaseIncidentDuplicateLock(actor, contentHash)).rejects.toMatchObject({
      statusCode: 503,
    });
  });
});
