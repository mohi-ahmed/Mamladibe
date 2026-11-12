import { Ratelimit, type Duration } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { getOptionalEnvValue } from '../config/env.js';
import {
  ADMIN,
  ADMIN_LOGIN_RATE,
  GEO_CONFIG,
  PATTERNS,
  RATE,
} from '../constants/index.js';
import { getUtcDayKey } from './dhaka-time.js';
import { createLogger } from './logger.js';
import { internalError, lockedError, rateLimitedError } from '../utils/errors.js';

const rlLogger = createLogger({ module: 'ratelimit' });

export interface WindowLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

export interface RateLimitStore {
  checkSlidingWindow(
    bucket: string,
    identifier: string,
    limit: number,
    windowMs: number,
    windowDuration: Duration,
  ): Promise<WindowLimitResult>;
  acquireOnceLock(key: string, ttlSeconds: number): Promise<boolean>;
  incrementCounterWithTtl(key: string, ttlSeconds: number): Promise<number>;
  getNumber(key: string): Promise<number | null>;
  getTtlSeconds(key: string): Promise<number>;
  setStringWithTtl(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void>;
  getString(key: string): Promise<string | null>;
  deleteKey(key: string): Promise<void>;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, number[]>();
  private readonly kv = new Map<string, { value: string; expiresAt: number }>();

  private pruneExpiredKv(key: string, now: number): { value: string; expiresAt: number } | null {
    const entry = this.kv.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.kv.delete(key);
      return null;
    }
    return entry;
  }

  public async checkSlidingWindow(
    bucket: string,
    identifier: string,
    limit: number,
    windowMs: number,
  ): Promise<WindowLimitResult> {
    const now = Date.now();
    const key = `${bucket}:${identifier}`;
    const cutoff = now - windowMs;
    const recent = (this.windows.get(key) ?? []).filter((ts) => ts > cutoff);

    if (recent.length >= limit) {
      const oldest = recent[0] ?? now;
      this.windows.set(key, recent);
      return {
        allowed: false,
        remaining: 0,
        resetMs: oldest + windowMs,
      };
    }

    recent.push(now);
    this.windows.set(key, recent);
    return {
      allowed: true,
      remaining: Math.max(limit - recent.length, 0),
      resetMs: now + windowMs,
    };
  }

  public async acquireOnceLock(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.pruneExpiredKv(key, now);
    if (existing) {
      return false;
    }
    this.kv.set(key, {
      value: '1',
      expiresAt: now + ttlSeconds * 1000,
    });
    return true;
  }

  public async incrementCounterWithTtl(
    key: string,
    ttlSeconds: number,
  ): Promise<number> {
    const now = Date.now();
    const existing = this.pruneExpiredKv(key, now);
    const nextValue = existing ? Number(existing.value) + 1 : 1;
    const expiresAt = existing ? existing.expiresAt : now + ttlSeconds * 1000;
    this.kv.set(key, { value: String(nextValue), expiresAt });
    return nextValue;
  }

  public async getNumber(key: string): Promise<number | null> {
    const entry = this.pruneExpiredKv(key, Date.now());
    if (!entry) return null;
    const parsed = Number(entry.value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  public async getTtlSeconds(key: string): Promise<number> {
    const now = Date.now();
    const entry = this.pruneExpiredKv(key, now);
    if (!entry) return 0;
    return Math.max(Math.ceil((entry.expiresAt - now) / 1000), 1);
  }

  public async setStringWithTtl(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    this.kv.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  public async getString(key: string): Promise<string | null> {
    const entry = this.pruneExpiredKv(key, Date.now());
    return entry ? entry.value : null;
  }

  public async deleteKey(key: string): Promise<void> {
    this.kv.delete(key);
    this.windows.delete(key);
  }

  public clear(): void {
    this.windows.clear();
    this.kv.clear();
  }
}

class UpstashRateLimitStore implements RateLimitStore {
  private readonly redis: Redis;
  private readonly limiters = new Map<string, Ratelimit>();

  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token });
  }

  private getLimiter(
    bucket: string,
    limit: number,
    windowDuration: Duration,
  ): Ratelimit {
    const key = `${bucket}:${limit}:${windowDuration}`;
    let limiter = this.limiters.get(key);
    if (!limiter) {
      limiter = new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.slidingWindow(limit, windowDuration),
        prefix: `mdb:rl:${bucket}`,
      });
      this.limiters.set(key, limiter);
    }
    return limiter;
  }

  public async checkSlidingWindow(
    bucket: string,
    identifier: string,
    limit: number,
    _windowMs: number,
    windowDuration: Duration,
  ): Promise<WindowLimitResult> {
    const limiter = this.getLimiter(bucket, limit, windowDuration);
    const result = await limiter.limit(identifier);
    return {
      allowed: result.success,
      remaining: result.remaining,
      resetMs: result.reset,
    };
  }

  public async acquireOnceLock(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(key, '1', { nx: true, ex: ttlSeconds });
    return result === 'OK';
  }

  public async incrementCounterWithTtl(
    key: string,
    ttlSeconds: number,
  ): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, ttlSeconds);
    }
    return count;
  }

  public async getNumber(key: string): Promise<number | null> {
    const value = await this.redis.get<number | string | null>(key);
    if (value === null || value === undefined) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  public async getTtlSeconds(key: string): Promise<number> {
    const ttl = await this.redis.ttl(key);
    return ttl > 0 ? ttl : 0;
  }

  public async setStringWithTtl(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(key, value, { ex: ttlSeconds });
  }

  public async getString(key: string): Promise<string | null> {
    const value = await this.redis.get<string | number | boolean | null>(key);
    if (value === null || value === undefined) {
      return null;
    }
    return String(value);
  }

  public async deleteKey(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

let activeStoreOverride: RateLimitStore | null = null;
let cachedUpstashStore: UpstashRateLimitStore | null = null;
const devInMemoryStore = new InMemoryRateLimitStore();
let devFallbackWarned = false;

export function setRateLimitStoreForTests(store: RateLimitStore | null): void {
  activeStoreOverride = store;
}

export function resetDevInMemoryRateLimitStore(): void {
  devInMemoryStore.clear();
}

function getRateLimitStore(): RateLimitStore {
  if (activeStoreOverride) {
    return activeStoreOverride;
  }

  const url = getOptionalEnvValue('UPSTASH_REDIS_REST_URL');
  const token = getOptionalEnvValue('UPSTASH_REDIS_REST_TOKEN');

  if (url && token) {
    if (!cachedUpstashStore) {
      cachedUpstashStore = new UpstashRateLimitStore(url, token);
    }
    return cachedUpstashStore;
  }

  if (process.env.NODE_ENV === 'production') {
    throw internalError('Rate-limit protection service is not configured.', 503);
  }

  if (process.env.NODE_ENV !== 'test' && !devFallbackWarned) {
    devFallbackWarned = true;
    rlLogger.warn(
      {},
      'Upstash Redis env vars not set; using in-memory rate-limit store for local non-production development only',
    );
  }

  return devInMemoryStore;
}

function toRetryAfterSeconds(resetMs: number): number {
  return Math.max(Math.ceil((resetMs - Date.now()) / 1000), 1);
}

async function runWithFailClosed<T>(op: (store: RateLimitStore) => Promise<T>): Promise<T> {
  const store = getRateLimitStore();
  try {
    return await op(store);
  } catch (error) {
    if (error instanceof Error && error.name === 'AppError') {
      throw error;
    }
    rlLogger.error(
      { errName: error instanceof Error ? error.name : 'UnknownError' },
      'Rate-limit store failure; failing closed',
    );
    throw internalError('Protection service is temporarily unavailable.', 503);
  }
}

export async function consumeIncidentCreateLimit(actorId: string): Promise<{
  allowed: boolean;
  retryAfterSeconds?: number;
}> {
  const result = await runWithFailClosed((store) =>
    store.checkSlidingWindow(
      'incident_create',
      actorId,
      RATE.INCIDENTS_PER_ACTOR_24H,
      24 * 60 * 60 * 1000,
      '24 h',
    ),
  );

  if (!result.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: toRetryAfterSeconds(result.resetMs),
    };
  }
  return { allowed: true };
}

const INCIDENT_DUPLICATE_LOCK_TTL_SECONDS = 60;

export async function acquireIncidentDuplicateLock(
  actorId: string,
  contentHash: string,
): Promise<boolean> {
  const key = `mdb:dup:incident:${actorId}:${contentHash}`;
  return runWithFailClosed((store) =>
    store.acquireOnceLock(key, INCIDENT_DUPLICATE_LOCK_TTL_SECONDS),
  );
}

export async function releaseIncidentDuplicateLock(
  actorId: string,
  contentHash: string,
): Promise<void> {
  const key = `mdb:dup:incident:${actorId}:${contentHash}`;
  await runWithFailClosed((store) => store.deleteKey(key));
}

export async function getRemainingCommentCooldownSeconds(
  actorId: string,
): Promise<number> {
  const key = `mdb:cd:comment:${actorId}`;
  return runWithFailClosed((store) => store.getTtlSeconds(key));
}

export async function acquireCommentCooldown(actorId: string): Promise<{
  allowed: boolean;
  retryAfterSeconds?: number;
}> {
  const key = `mdb:cd:comment:${actorId}`;
  const acquired = await runWithFailClosed((store) =>
    store.acquireOnceLock(key, RATE.COMMENT_COOLDOWN_SEC),
  );
  if (!acquired) {
    const ttl = await runWithFailClosed((store) => store.getTtlSeconds(key));
    return {
      allowed: false,
      retryAfterSeconds: Math.max(ttl, 1),
    };
  }
  return { allowed: true };
}

export async function releaseCommentCooldown(actorId: string): Promise<void> {
  const key = `mdb:cd:comment:${actorId}`;
  await runWithFailClosed((store) => store.deleteKey(key));
}

export async function getCommentIpHitCount(
  ipHash: string,
  now: Date = new Date(),
): Promise<number> {
  assertValidIpHash(ipHash, 'comment IP lookup');
  const key = `mdb:ipcap:comment:${getUtcDayKey(now)}:${ipHash}`;
  const count = await runWithFailClosed((store) => store.getNumber(key));
  return count ?? 0;
}

export async function recordCommentIpHit(
  ipHash: string,
  now: Date = new Date(),
): Promise<{ softCapExceeded: boolean; count: number }> {
  assertValidIpHash(ipHash, 'comment IP hit');
  const key = `mdb:ipcap:comment:${getUtcDayKey(now)}:${ipHash}`;
  const count = await runWithFailClosed((store) =>
    store.incrementCounterWithTtl(key, 24 * 60 * 60),
  );
  return {
    softCapExceeded: count > RATE.COMMENTS_PER_IP_PER_DAY_SOFT,
    count,
  };
}

export async function consumeVoteActionLimit(actorId: string): Promise<void> {
  const result = await runWithFailClosed((store) =>
    store.checkSlidingWindow(
      'vote_action',
      actorId,
      RATE.VOTE_ACTIONS_PER_ACTOR_PER_HOUR,
      60 * 60 * 1000,
      '1 h',
    ),
  );
  if (!result.allowed) {
    throw rateLimitedError('Too many vote actions. Please try again later.', {
      retryAfterSeconds: toRetryAfterSeconds(result.resetMs),
    });
  }
}

export async function consumeFlagActionLimit(actorId: string): Promise<void> {
  const result = await runWithFailClosed((store) =>
    store.checkSlidingWindow(
      'flag_action',
      actorId,
      RATE.FLAG_ACTIONS_PER_ACTOR_PER_DAY,
      24 * 60 * 60 * 1000,
      '24 h',
    ),
  );
  if (!result.allowed) {
    throw rateLimitedError('Daily flag limit reached. Please try again later.', {
      retryAfterSeconds: toRetryAfterSeconds(result.resetMs),
    });
  }
}

export async function assertTrackNotLocked(trackingId: string): Promise<void> {
  const lockKey = `mdb:track:lock:${trackingId}`;
  const locked = await runWithFailClosed((store) => store.getString(lockKey));
  if (locked) {
    const retryAfterSeconds = await runWithFailClosed((store) =>
      store.getTtlSeconds(lockKey),
    );
    throw lockedError('Too many failed tracking attempts. Try again later.', {
      retryAfterSeconds: Math.max(retryAfterSeconds, 1),
    });
  }
}

export async function recordTrackFailure(trackingId: string): Promise<{
  lockedNow: boolean;
  attempts: number;
  retryAfterSeconds?: number;
}> {
  const failKey = `mdb:track:fails:${trackingId}`;
  const lockKey = `mdb:track:lock:${trackingId}`;
  const lockTtl = RATE.TRACK_LOCK_MINUTES * 60;

  const attempts = await runWithFailClosed((store) =>
    store.incrementCounterWithTtl(failKey, lockTtl),
  );

  if (attempts >= RATE.TRACK_FAILS_BEFORE_LOCK) {
    await runWithFailClosed(async (store) => {
      await store.setStringWithTtl(lockKey, '1', lockTtl);
      await store.deleteKey(failKey);
    });
    return {
      lockedNow: true,
      attempts,
      retryAfterSeconds: lockTtl,
    };
  }

  return { lockedNow: false, attempts };
}

export async function clearTrackFailures(trackingId: string): Promise<void> {
  await runWithFailClosed((store) =>
    store.deleteKey(`mdb:track:fails:${trackingId}`),
  );
}

function assertValidIpHash(ipHash: string, contextLabel: string): void {
  if (!PATTERNS.IP_HASH_HEX.test(ipHash)) {
    throw internalError(
      `Invalid IP hash format for ${contextLabel}.`,
      500,
    );
  }
}

export async function consumeAdminLoginRateLimit(ipHash: string): Promise<void> {
  assertValidIpHash(ipHash, 'admin login rate limit');
  const result = await runWithFailClosed((store) =>
    store.checkSlidingWindow(
      'admin_login',
      ipHash,
      ADMIN_LOGIN_RATE.ATTEMPTS_PER_IP_WINDOW,
      ADMIN_LOGIN_RATE.WINDOW_MINUTES * 60 * 1000,
      `${ADMIN_LOGIN_RATE.WINDOW_MINUTES} m` as Duration,
    ),
  );
  if (!result.allowed) {
    throw rateLimitedError('Too many login attempts. Try again later.', {
      retryAfterSeconds: toRetryAfterSeconds(result.resetMs),
    });
  }
}

export async function consumeGeoRateLimit(identifier: string): Promise<void> {
  assertValidIpHash(identifier, 'geo rate limit');
  const result = await runWithFailClosed((store) =>
    store.checkSlidingWindow(
      'geo_proxy',
      identifier,
      GEO_CONFIG.RATE_LIMIT_PER_MIN,
      60 * 1000,
      '1 m',
    ),
  );
  if (!result.allowed) {
    throw rateLimitedError('Too many location lookup requests. Slow down.', {
      retryAfterSeconds: toRetryAfterSeconds(result.resetMs),
    });
  }
}

export async function claimTotpReplayWindow(
  adminId: string,
  code: string,
): Promise<boolean> {
  const key = `mdb:totp:used:${adminId}:${code}`;
  // Prevent replay across the +-1 step window (~90 seconds)
  return runWithFailClosed((store) => store.acquireOnceLock(key, 90));
}

export async function consumePending2faSessionFailure(
  sessionId: string,
): Promise<{ attempts: number; exhausted: boolean }> {
  const key = `mdb:totp:session_fails:${sessionId}`;
  const ttlSeconds = ADMIN.PENDING_2FA_WINDOW_MINUTES * 60;
  const attempts = await runWithFailClosed((store) =>
    store.incrementCounterWithTtl(key, ttlSeconds),
  );
  return {
    attempts,
    exhausted: attempts >= ADMIN.TOTP_SESSION_MAX_FAILS,
  };
}

export async function clearPending2faSessionFailures(
  sessionId: string,
): Promise<void> {
  await runWithFailClosed((store) =>
    store.deleteKey(`mdb:totp:session_fails:${sessionId}`),
  );
}
