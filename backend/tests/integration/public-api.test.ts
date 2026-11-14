import type { AddressInfo } from 'node:net';
import mongoose, { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { CATEGORIES, RATE } from '../../src/constants/index.js';
import { setTurnstileVerifierForTests } from '../../src/lib/captcha.js';
import { computeActorId } from '../../src/lib/crypto.js';
import { setGeocodingProviderForTests } from '../../src/lib/geocoding.js';
import { createLogger } from '../../src/lib/logger.js';
import {
  InMemoryRateLimitStore,
  resetDevInMemoryRateLimitStore,
  setRateLimitStoreForTests,
} from '../../src/lib/ratelimit.js';
import { computeIncidentContentHash } from '../../src/lib/text-rules.js';
import { hashReporterSecret } from '../../src/lib/tracking.js';
import {
  AbuseSignalModel,
  ActorModel,
  CommentModel,
  DailyQuotaModel,
  GeoCacheModel,
  IncidentModel,
  IncidentVersionModel,
  ReportModel,
  SettingModel,
  VoteModel,
} from '../../src/models/index.js';

const ORIGIN = 'http://localhost:5173';
const ACTOR_SECRET = 'test-actor-secret-at-least-32-chars-long';
const IP_SECRET = 'test-ip-secret-at-least-32-chars-long-ok';

function chain<T>(result: T) {
  return {
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(result),
  };
}

function extractActorCookie(response: Response): string | undefined {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) return undefined;
  const match = /mdb_actor=([^;]+)/.exec(setCookie);
  return match ? `mdb_actor=${match[1]}` : undefined;
}

async function withServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = createApp({
    allowedOrigins: [ORIGIN],
    logger: createLogger({}, 'silent'),
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    return await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe('Public API v1 integration tests (T02-T08)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.ACTOR_HMAC_SECRET = ACTOR_SECRET;
    process.env.IP_HMAC_SECRET = IP_SECRET;
    process.env.TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
    process.env.NODE_ENV = 'test';

    resetDevInMemoryRateLimitStore();
    setRateLimitStoreForTests(new InMemoryRateLimitStore());
    setTurnstileVerifierForTests(async ({ token }) => token === 'valid-captcha');
    setGeocodingProviderForTests(null);

    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);
    vi.spyOn(SettingModel, 'find').mockReturnValue(chain([]) as never);
    vi.spyOn(ActorModel, 'findOneAndUpdate').mockImplementation(((
      filter: { actorId?: string },
    ) =>
      chain({
        actorId: filter.actorId ?? 'actor-default',
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      })) as never);
    vi.spyOn(AbuseSignalModel, 'create').mockResolvedValue({} as never);
    vi.spyOn(AbuseSignalModel, 'countDocuments').mockResolvedValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    resetDevInMemoryRateLimitStore();
    setRateLimitStoreForTests(null);
    setTurnstileVerifierForTests(null);
    setGeocodingProviderForTests(null);
  });

  it('serves GET /api/v1/meta with 1h cache headers and PRD constants', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/meta`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('public, max-age=3600');

      const body = (await res.json()) as Record<string, unknown>;
      expect(body.categories).toEqual([...CATEGORIES]);
      expect(body.turnstileSiteKey).toBe('1x00000000000000000000AA');
      expect(body.timezone).toBe('Asia/Dhaka');
    });
  });

  it('enforces Origin check on state-changing requests (403 FORBIDDEN)', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/track`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://attacker.example.com',
        },
        body: JSON.stringify({
          trackingId: 'MD-7K3Q9XTB',
          secret: '4F8QZ-N2M7C-KX9TA-W5H1R-D',
        }),
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('FORBIDDEN');
    });
  });

  it('creates an incident, sets mdb_actor cookie, returns credentials once, and hides secretHash', async () => {
    vi.spyOn(IncidentModel, 'exists').mockResolvedValue(null);
    const createdId = new Types.ObjectId();
    const now = new Date();
    const createSpy = vi
      .spyOn(IncidentModel, 'create')
      .mockImplementation((async (doc: Record<string, unknown>) => {
        const plain = {
          ...doc,
          _id: createdId,
          createdAt: doc.createdAt ?? now,
        };
        return {
          ...plain,
          toObject: () => plain,
        };
      }) as never);

    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
        },
        body: JSON.stringify({
          title: 'Bus collision near Mirpur 10 intersection',
          description:
            'A passenger bus hit a divider near the metro pillar, blocking two lanes during evening traffic.',
          category: 'road_accident',
          incidentAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          location: { lat: 23.80692, lng: 90.36866 },
          areaName: 'Mirpur 10',
          district: 'Dhaka',
          safetyTip: 'Use the alternate service road.',
          captchaToken: 'valid-captcha',
        }),
      });

      expect(res.status).toBe(201);
      const cookie = extractActorCookie(res);
      expect(cookie).toBeDefined();
      expect(res.headers.get('set-cookie')).toContain('HttpOnly');
      expect(res.headers.get('set-cookie')).toContain('SameSite=Lax');

      const body = (await res.json()) as {
        incident: Record<string, unknown>;
        credentials: { trackingId: string; secret: string };
      };

      expect(body.credentials.trackingId).toMatch(/^MD-[0-9A-HJKMNP-TV-Z]{8}$/);
      expect(body.credentials.secret).toMatch(
        /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}-[0-9A-HJKMNP-TV-Z]$/,
      );
      expect(body.incident.trackingId).toBe(body.credentials.trackingId);
      expect(body.incident).not.toHaveProperty('secretHash');
      expect(body.incident).not.toHaveProperty('actorId');
      expect(createSpy).toHaveBeenCalledOnce();
    });
  });

  it('rejects Bangla/Latin phone numbers, URLs, restricted actors, frozen posting, and 6th report rate limit', async () => {
    vi.spyOn(IncidentModel, 'exists').mockResolvedValue(null);

    await withServer(async (baseUrl) => {
      // 1. Contact info detection (Bangla phone digits)
      const contactRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({
          title: 'Suspicious demand reported on main street',
          description: 'Please contact ০১৭১১-২২৩৩৪৪ if anyone witnessed the incident.',
          category: 'other',
          incidentAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          location: { lat: 23.81, lng: 90.41 },
          captchaToken: 'valid-captcha',
        }),
      });
      expect(contactRes.status).toBe(400);
      const contactBody = (await contactRes.json()) as {
        error: { code: string; details?: { reason?: string } };
      };
      expect(contactBody.error.code).toBe('VALIDATION_ERROR');
      expect(contactBody.error.details?.reason).toBe('CONTACT_INFO_NOT_ALLOWED');

      // 2. Freeze posting check
      vi.spyOn(SettingModel, 'find').mockReturnValueOnce(
        chain([{ key: 'freeze_posting', value: true }]) as never,
      );
      const frozenRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({
          title: 'Road blockade near Farmgate junction',
          description: 'Heavy traffic delay reported near the footbridge area.',
          category: 'road_accident',
          incidentAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
          location: { lat: 23.756, lng: 90.388 },
          captchaToken: 'valid-captcha',
        }),
      });
      expect(frozenRes.status).toBe(403);

      // 3. 24h incident rate limit (5 allowed, 6th returns 429 + Retry-After)
      let cookie: string | undefined;
      vi.spyOn(IncidentModel, 'create').mockImplementation((async (
        doc: Record<string, unknown>,
      ) => {
        const plain = {
          ...doc,
          _id: new Types.ObjectId(),
          createdAt: new Date(),
        };
        return {
          ...plain,
          toObject: () => plain,
        };
      }) as never);

      for (let i = 0; i < RATE.INCIDENTS_PER_ACTOR_24H + 1; i += 1) {
        const res = await fetch(`${baseUrl}/api/v1/incidents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            ...(cookie ? { Cookie: cookie } : {}),
          },
          body: JSON.stringify({
            title: `Traffic hazard report number ${i + 100} near Dhanmondi`,
            description: `Detailed report body number ${i + 100} describing unsafe road conditions.`,
            category: 'infrastructure',
            incidentAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
            location: { lat: 23.746, lng: 90.376 },
            captchaToken: 'valid-captcha',
          }),
        });
        cookie = cookie ?? extractActorCookie(res);
        if (i < RATE.INCIDENTS_PER_ACTOR_24H) {
          expect(res.status).toBe(201);
        } else {
          expect(res.status).toBe(429);
          expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
          const body = (await res.json()) as { error: { code: string } };
          expect(body.error.code).toBe('RATE_LIMITED');
        }
      }
    });
  });

  it('lists incidents by bbox and nearest distance, and fetches public incident details with my-state', async () => {
    const incidentId = new Types.ObjectId();
    const sampleDoc = {
      _id: incidentId,
      trackingId: 'MD-7K3Q9XTB',
      actorId: 'a'.repeat(32),
      secretHash: 'f'.repeat(64),
      title: 'Streetlight outage near Uttara Sector 7',
      description: 'Multiple streetlights along the avenue have stopped working at night.',
      contentHash: computeIncidentContentHash({
        title: 'Streetlight outage near Uttara Sector 7',
        description: 'Multiple streetlights along the avenue have stopped working at night.',
      }),
      category: 'public_safety',
      incidentAt: new Date('2026-11-10T10:00:00.000Z'),
      location: { type: 'Point' as const, coordinates: [90.4001, 23.869] as [number, number] },
      areaName: 'Uttara',
      district: 'Dhaka',
      status: 'published' as const,
      source: 'public' as const,
      isEdited: false,
      editCount: 0,
      moderatedEdit: false,
      createdAt: new Date('2026-11-10T10:05:00.000Z'),
    };

    vi.spyOn(IncidentModel, 'find').mockReturnValue(chain([sampleDoc]) as never);
    vi.spyOn(IncidentModel, 'findOne').mockReturnValue(chain(sampleDoc) as never);
    vi.spyOn(CommentModel, 'aggregate').mockResolvedValue([
      { _id: incidentId, count: 2 },
    ] as never);
    vi.spyOn(CommentModel, 'countDocuments').mockResolvedValue(2);
    vi.spyOn(VoteModel, 'aggregate').mockImplementation((async (pipeline: unknown[]) => {
      const serialized = JSON.stringify(pipeline);
      return serialized.includes('incidentId\",\"type')
        ? [
            { _id: { incidentId, type: 'support' }, count: 5 },
            { _id: { incidentId, type: 'dispute' }, count: 1 },
          ]
        : [
            { _id: 'support', count: 5 },
            { _id: 'dispute', count: 1 },
          ];
    }) as never);
    vi.spyOn(ReportModel, 'aggregate').mockResolvedValue([
      { _id: incidentId, count: 1 },
    ] as never);
    vi.spyOn(ReportModel, 'countDocuments').mockResolvedValue(1);
    vi.spyOn(VoteModel, 'findOne').mockReturnValue(chain({ type: 'support' }) as never);
    vi.spyOn(ReportModel, 'exists').mockResolvedValue(null);

    await withServer(async (baseUrl) => {
      const listRes = await fetch(
        `${baseUrl}/api/v1/incidents?bbox=90.30,23.70,90.50,23.95`,
      );
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as {
        items: Array<Record<string, unknown>>;
        truncated: boolean;
      };
      expect(listBody.items).toHaveLength(1);
      expect(listBody.items[0]!.trackingId).toBe('MD-7K3Q9XTB');
      expect(listBody.items[0]!.counts).toEqual({
        support: 5,
        dispute: 1,
        flags: 1,
        comments: 2,
      });
      expect(listBody.items[0]).toMatchObject({
        description: sampleDoc.description,
        location: { lat: 23.869, lng: 90.4001 },
        my: { vote: null, flagged: false },
      });
      expect(listBody.truncated).toBe(false);

      const nearRes = await fetch(
        `${baseUrl}/api/v1/incidents?near=23.8700,90.4000&sort=nearest&radiusKm=10`,
      );
      expect(nearRes.status).toBe(200);
      const nearBody = (await nearRes.json()) as {
        items: Array<{ distanceKm: number }>;
      };
      expect(nearBody.items[0]!.distanceKm).toBeGreaterThanOrEqual(0);

      const token = 'a'.repeat(43);
      const detailRes = await fetch(`${baseUrl}/api/v1/incidents/MD-7K3Q9XTB`, {
        headers: { Cookie: `mdb_actor=${token}` },
      });
      expect(detailRes.status).toBe(200);
      const detailBody = (await detailRes.json()) as Record<string, unknown> & {
        counts: { support: number; dispute: number; flags: number; comments: number };
        my: { vote: string | null; flagged: boolean };
      };
      expect(detailBody.counts).toEqual({
        support: 5,
        dispute: 1,
        flags: 1,
        comments: 2,
      });
      expect(detailBody.my).toEqual({ vote: 'support', flagged: false });
      expect(detailBody).not.toHaveProperty('actorId');
      expect(detailBody).not.toHaveProperty('secretHash');
    });
  });

  it('supports voting, switching, removing votes, and deduplicating flags', async () => {
    const incidentId = new Types.ObjectId();
    vi.spyOn(IncidentModel, 'findOne').mockReturnValue(
      chain({ _id: incidentId }) as never,
    );
    vi.spyOn(VoteModel, 'findOneAndUpdate').mockResolvedValue({} as never);
    vi.spyOn(VoteModel, 'deleteOne').mockResolvedValue({ deletedCount: 1 } as never);
    vi.spyOn(VoteModel, 'aggregate')
      .mockResolvedValueOnce([{ _id: 'support', count: 1 }] as never)
      .mockResolvedValueOnce([{ _id: 'dispute', count: 1 }] as never)
      .mockResolvedValueOnce([] as never);

    await withServer(async (baseUrl) => {
      const supportRes = await fetch(`${baseUrl}/api/v1/incidents/MD-7K3Q9XTB/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({ type: 'support' }),
      });
      expect(supportRes.status).toBe(200);
      const cookie = extractActorCookie(supportRes);
      expect(await supportRes.json()).toEqual({
        counts: { support: 1, dispute: 0 },
        my: { vote: 'support' },
      });

      const switchRes = await fetch(`${baseUrl}/api/v1/incidents/MD-7K3Q9XTB/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify({ type: 'dispute' }),
      });
      expect(switchRes.status).toBe(200);
      expect(await switchRes.json()).toEqual({
        counts: { support: 0, dispute: 1 },
        my: { vote: 'dispute' },
      });

      const deleteRes = await fetch(`${baseUrl}/api/v1/incidents/MD-7K3Q9XTB/vote`, {
        method: 'DELETE',
        headers: {
          Origin: ORIGIN,
          ...(cookie ? { Cookie: cookie } : {}),
        },
      });
      expect(deleteRes.status).toBe(200);
      expect(await deleteRes.json()).toEqual({
        counts: { support: 0, dispute: 0 },
        my: { vote: null },
      });

      vi.spyOn(ReportModel, 'create')
        .mockResolvedValueOnce({} as never)
        .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));
      vi.spyOn(ReportModel, 'countDocuments').mockResolvedValue(1);

      const firstFlag = await fetch(`${baseUrl}/api/v1/incidents/MD-7K3Q9XTB/reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify({ reason: 'spam', note: 'Repeated promotion post' }),
      });
      expect(firstFlag.status).toBe(201);
      expect(await firstFlag.json()).toEqual({ reported: true, flags: 1 });

      const secondFlag = await fetch(`${baseUrl}/api/v1/incidents/MD-7K3Q9XTB/reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify({ reason: 'spam' }),
      });
      expect(secondFlag.status).toBe(409);
      const dupBody = (await secondFlag.json()) as { error: { code: string } };
      expect(dupBody.error.code).toBe('DUPLICATE_ACTION');
    });
  });

  it('enforces comment quota, cooldown, hidden placeholders, self-delete window, and comment reporting', async () => {
    const incidentId = new Types.ObjectId();
    const commentId = new Types.ObjectId();
    const browserToken = 'B'.repeat(43);
    const callerActorId = computeActorId(browserToken, ACTOR_SECRET);

    vi.spyOn(IncidentModel, 'findOne').mockReturnValue(
      chain({ _id: incidentId }) as never,
    );
    vi.spyOn(IncidentModel, 'exists').mockResolvedValue({ _id: incidentId });

    await withServer(async (baseUrl) => {
      // List comments shows hidden as placeholder and computes mine correctly
      vi.spyOn(CommentModel, 'find').mockReturnValueOnce(
        chain([
          {
            _id: commentId,
            incidentId,
            actorId: callerActorId,
            type: 'info',
            body: 'Traffic police arrived and cleared the lane.',
            status: 'published',
            redacted: false,
            createdAt: new Date(),
          },
          {
            _id: new Types.ObjectId(),
            incidentId,
            actorId: 'other-actor',
            type: 'correction',
            body: 'hidden text should not leak',
            status: 'hidden',
            redacted: false,
            createdAt: new Date(),
          },
        ]) as never,
      );

      const listRes = await fetch(
        `${baseUrl}/api/v1/incidents/MD-7K3Q9XTB/comments`,
        { headers: { Cookie: `mdb_actor=${browserToken}` } },
      );
      expect(listRes.status).toBe(200);
      const listJson = (await listRes.json()) as {
        items: Array<{ body: string | null; placeholder: boolean; mine: boolean }>;
      };
      expect(listJson.items[0]!.mine).toBe(true);
      expect(listJson.items[1]!.placeholder).toBe(true);
      expect(listJson.items[1]!.body).toBeNull();

      // Quota remaining check
      vi.spyOn(DailyQuotaModel, 'findOne').mockReturnValueOnce(
        chain({ count: 5 }) as never,
      );
      const quotaRes = await fetch(`${baseUrl}/api/v1/me/quota`, {
        headers: { Cookie: `mdb_actor=${browserToken}` },
      });
      expect(quotaRes.status).toBe(200);
      const quotaJson = (await quotaRes.json()) as { commentsLeft: number };
      expect(quotaJson.commentsLeft).toBe(0);

      // Atomic quota exhaustion rejects with 429 QUOTA_EXCEEDED
      vi.spyOn(DailyQuotaModel, 'findOneAndUpdate').mockReturnValueOnce({
        lean: vi
          .fn()
          .mockRejectedValueOnce(
            Object.assign(new Error('E11000'), { code: 11000 }),
          ),
      } as never);
      const exhaustedRes = await fetch(
        `${baseUrl}/api/v1/incidents/MD-7K3Q9XTB/comments`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            Cookie: `mdb_actor=${browserToken}`,
          },
          body: JSON.stringify({
            type: 'info',
            body: 'Sixth comment today should fail cleanly.',
          }),
        },
      );
      expect(exhaustedRes.status).toBe(429);
      const exhaustedBody = (await exhaustedRes.json()) as {
        error: { code: string; details?: { resetsAt?: string } };
      };
      expect(exhaustedBody.error.code).toBe('QUOTA_EXCEEDED');
      expect(exhaustedBody.error.details?.resetsAt).toBeDefined();

      // Cooldown blocks rapid second attempt before atomic quota is even touched
      const cooldownRes = await fetch(
        `${baseUrl}/api/v1/incidents/MD-7K3Q9XTB/comments`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            Cookie: `mdb_actor=${browserToken}`,
          },
          body: JSON.stringify({
            type: 'info',
            body: 'Immediate second comment triggers cooldown.',
          }),
        },
      );
      expect(cooldownRes.status).toBe(429);
      expect((await cooldownRes.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'RATE_LIMITED' },
      });

      // Self-delete succeeds within 15 min
      vi.spyOn(CommentModel, 'findOne').mockReturnValueOnce(
        chain({
          _id: commentId,
          incidentId,
          actorId: callerActorId,
          status: 'published',
          createdAt: new Date(Date.now() - 2 * 60 * 1000),
        }) as never,
      );
      const delUpdateSpy = vi
        .spyOn(CommentModel, 'updateOne')
        .mockResolvedValueOnce({ modifiedCount: 1 } as never);

      const delRes = await fetch(`${baseUrl}/api/v1/comments/${commentId.toString()}`, {
        method: 'DELETE',
        headers: { Origin: ORIGIN, Cookie: `mdb_actor=${browserToken}` },
      });
      expect(delRes.status).toBe(200);
      expect(await delRes.json()).toEqual({ deleted: true });
      expect(delUpdateSpy).toHaveBeenCalledOnce();

      // Self-delete after 15 min fails with 403 EDIT_WINDOW_CLOSED
      vi.spyOn(CommentModel, 'findOne').mockReturnValueOnce(
        chain({
          _id: commentId,
          incidentId,
          actorId: callerActorId,
          status: 'published',
          createdAt: new Date(Date.now() - 20 * 60 * 1000),
        }) as never,
      );
      const expiredDelRes = await fetch(
        `${baseUrl}/api/v1/comments/${commentId.toString()}`,
        {
          method: 'DELETE',
          headers: { Origin: ORIGIN, Cookie: `mdb_actor=${browserToken}` },
        },
      );
      expect(expiredDelRes.status).toBe(403);
      expect(
        ((await expiredDelRes.json()) as { error: { code: string } }).error.code,
      ).toBe('EDIT_WINDOW_CLOSED');

      // Reporting a comment omits flags count
      vi.spyOn(CommentModel, 'findOne').mockReturnValueOnce(
        chain({ _id: commentId, incidentId, status: 'published' }) as never,
      );
      vi.spyOn(ReportModel, 'create').mockResolvedValueOnce({} as never);
      const repCommentRes = await fetch(
        `${baseUrl}/api/v1/comments/${commentId.toString()}/reports`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            Cookie: `mdb_actor=${browserToken}`,
          },
          body: JSON.stringify({ reason: 'inappropriate' }),
        },
      );
      expect(repCommentRes.status).toBe(201);
      expect(await repCommentRes.json()).toEqual({ reported: true });
    });
  });

  it('tracks with typo-tolerant secret, snapshots versions on <=30% edit, rejects >30% and locks after 5 wrong attempts', async () => {
    const incidentId = new Types.ObjectId();
    const rawSecret = '4F01Z-N2M7C-KX9TA-W5H1R-D8P2Q-A';
    const typoSecret = ' 4foiz-n2m7c-kx9ta-w5h1r-d8p2q-a ';
    const createdRecently = new Date(Date.now() - 3 * 60 * 1000);

    const baseIncident = {
      _id: incidentId,
      trackingId: 'MD-7K3Q9XTB',
      actorId: 'a'.repeat(32),
      secretHash: hashReporterSecret(rawSecret),
      title: 'Waterlogging blocking Dhanmondi 27 road',
      description: 'Ankle deep water is slowing traffic near the east intersection.',
      contentHash: computeIncidentContentHash({
        title: 'Waterlogging blocking Dhanmondi 27 road',
        description: 'Ankle deep water is slowing traffic near the east intersection.',
      }),
      category: 'infrastructure',
      incidentAt: new Date(Date.now() - 10 * 60 * 1000),
      location: { type: 'Point' as const, coordinates: [90.376, 23.752] as [number, number] },
      areaName: 'Dhanmondi',
      district: 'Dhaka',
      status: 'published' as const,
      source: 'public' as const,
      isEdited: false,
      editCount: 0,
      moderatedEdit: false,
      createdAt: createdRecently,
    };

    vi.spyOn(IncidentModel, 'findOne').mockReturnValue(chain(baseIncident) as never);
    vi.spyOn(VoteModel, 'aggregate').mockResolvedValue([] as never);
    vi.spyOn(ReportModel, 'countDocuments').mockResolvedValue(0);
    vi.spyOn(CommentModel, 'countDocuments').mockResolvedValue(0);
    vi.spyOn(IncidentVersionModel, 'find').mockReturnValue(chain([]) as never);

    await withServer(async (baseUrl) => {
      const trackRes = await fetch(`${baseUrl}/api/v1/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({
          trackingId: 'md-7k3q9xtb',
          secret: typoSecret,
        }),
      });
      expect(trackRes.status).toBe(200);
      expect(trackRes.headers.get('cache-control')).toBe('no-store');
      const trackBody = (await trackRes.json()) as {
        status: string;
        edit: { allowed: boolean; editsLeft: number };
      };
      expect(trackBody.status).toBe('published');
      expect(trackBody.edit.allowed).toBe(true);
      expect(trackBody.edit.editsLeft).toBe(3);

      // >30% change fails
      const bigEditRes = await fetch(`${baseUrl}/api/v1/incidents/MD-7K3Q9XTB`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({
          secret: rawSecret,
          title: 'Completely unrelated incident somewhere else',
        }),
      });
      expect(bigEditRes.status).toBe(400);
      const bigEditJson = (await bigEditRes.json()) as {
        error: { details?: { reason?: string } };
      };
      expect(bigEditJson.error.details?.reason).toBe('CHANGE_TOO_LARGE');

      // <=30% edit succeeds and snapshots IncidentVersionModel
      const versionSpy = vi
        .spyOn(IncidentVersionModel, 'create')
        .mockResolvedValueOnce({} as never);
      vi.spyOn(IncidentModel, 'findOneAndUpdate').mockReturnValueOnce(
        chain({
          ...baseIncident,
          title: 'Waterlogging blocking Dhanmondi 27 lane',
          isEdited: true,
          editCount: 1,
          editedAt: new Date(),
        }) as never,
      );

      const smallEditRes = await fetch(`${baseUrl}/api/v1/incidents/MD-7K3Q9XTB`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({
          secret: rawSecret,
          title: 'Waterlogging blocking Dhanmondi 27 lane',
        }),
      });
      expect(smallEditRes.status).toBe(200);
      expect(versionSpy).toHaveBeenCalledOnce();

      // Wrong secret 5 times locks tracking with 423 LOCKED
      for (let i = 1; i < RATE.TRACK_FAILS_BEFORE_LOCK; i += 1) {
        const failRes = await fetch(`${baseUrl}/api/v1/track`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
          body: JSON.stringify({
            trackingId: 'MD-7K3Q9XTB',
            secret: 'WRONG-WRONG-WRONG-WRONG-WRONG-W',
          }),
        });
        expect(failRes.status).toBe(401);
      }

      const lockingAttemptRes = await fetch(`${baseUrl}/api/v1/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({
          trackingId: 'MD-7K3Q9XTB',
          secret: 'WRONG-WRONG-WRONG-WRONG-WRONG-W',
        }),
      });
      expect(lockingAttemptRes.status).toBe(423);
      expect(
        ((await lockingAttemptRes.json()) as { error: { code: string } }).error.code,
      ).toBe('LOCKED');

      // Even the valid secret is rejected while locked
      const lockedRes = await fetch(`${baseUrl}/api/v1/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({
          trackingId: 'MD-7K3Q9XTB',
          secret: rawSecret,
        }),
      });
      expect(lockedRes.status).toBe(423);
      expect(((await lockedRes.json()) as { error: { code: string } }).error.code).toBe(
        'LOCKED',
      );
    });
  });

  it('serves /geo/reverse and /geo/search with validation and graceful fallback', async () => {
    vi.spyOn(GeoCacheModel, 'findOne').mockReturnValue(chain(null) as never);
    vi.spyOn(GeoCacheModel, 'findOneAndUpdate').mockResolvedValue({} as never);
    setGeocodingProviderForTests({
      reverseBarikoi: vi.fn(),
      reverseNominatim: vi.fn().mockRejectedValue(new Error('offline')),
      searchBarikoi: vi.fn(),
      searchNominatim: vi.fn().mockResolvedValue([
        {
          displayName: 'Dhanmondi 27, Dhaka',
          lat: 23.7512,
          lng: 90.3765,
          areaName: 'Dhanmondi',
          district: 'Dhaka',
        },
      ]),
    });

    await withServer(async (baseUrl) => {
      const badBounds = await fetch(`${baseUrl}/api/v1/geo/reverse?lat=10&lng=90`);
      expect(badBounds.status).toBe(400);

      const revRes = await fetch(`${baseUrl}/api/v1/geo/reverse?lat=23.81&lng=90.41`);
      expect(revRes.status).toBe(200);
      expect(await revRes.json()).toEqual({ fallback: true });

      const searchRes = await fetch(`${baseUrl}/api/v1/geo/search?q=Dhanmondi`);
      expect(searchRes.status).toBe(200);
      const searchJson = (await searchRes.json()) as {
        fallback: boolean;
        items: Array<{ displayName: string }>;
      };
      expect(searchJson.fallback).toBe(false);
      expect(searchJson.items[0]!.displayName).toContain('Dhanmondi');
    });
  });

  it('Phase 2A regression (BUG-SEC-4): fails closed (500) without raw-IP fallback when IP_HMAC_SECRET is missing', async () => {
    delete process.env.IP_HMAC_SECRET;

    const geoSpy = vi.fn();
    setGeocodingProviderForTests({
      reverseBarikoi: geoSpy,
      reverseNominatim: geoSpy,
      searchBarikoi: geoSpy,
      searchNominatim: geoSpy,
    });
    const incidentCreateSpy = vi.spyOn(IncidentModel, 'create');
    const incidentFindOneSpy = vi.spyOn(IncidentModel, 'findOne');
    const voteSpy = vi.spyOn(VoteModel, 'findOneAndUpdate');
    const reportCreateSpy = vi.spyOn(ReportModel, 'create');
    const commentCreateSpy = vi.spyOn(CommentModel, 'create');
    const store = new InMemoryRateLimitStore();
    const slidingSpy = vi.spyOn(store, 'checkSlidingWindow');
    setRateLimitStoreForTests(store);

    const commentId = new Types.ObjectId();

    await withServer(async (baseUrl) => {
      const geoRevRes = await fetch(`${baseUrl}/api/v1/geo/reverse?lat=23.81&lng=90.41`);
      expect(geoRevRes.status).toBe(500);
      const geoRevText = await geoRevRes.text();
      expect(geoRevText).not.toContain('127.0.0.1');

      const geoSearchRes = await fetch(`${baseUrl}/api/v1/geo/search?q=Dhaka`);
      expect(geoSearchRes.status).toBe(500);

      const createRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': '203.0.113.55',
        },
        body: JSON.stringify({
          title: 'Road pothole reported without IP secret configured',
          description: 'Detailed report body with enough characters to pass validator checks.',
          category: 'infrastructure',
          incidentAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
          location: { lat: 23.746, lng: 90.376 },
          captchaToken: 'valid-captcha',
        }),
      });
      expect(createRes.status).toBe(500);
      expect(await createRes.text()).not.toContain('203.0.113.55');

      const cookieRes = 'a'.repeat(32);
      const authedHeaders = {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: `mdb_actor=${cookieRes}`,
        'X-Forwarded-For': '203.0.113.55',
      };

      const voteRes = await fetch(`${baseUrl}/api/v1/incidents/MD-7K3Q9XTB/vote`, {
        method: 'POST',
        headers: authedHeaders,
        body: JSON.stringify({ type: 'support' }),
      });
      expect(voteRes.status).toBe(500);

      const delVoteRes = await fetch(`${baseUrl}/api/v1/incidents/MD-7K3Q9XTB/vote`, {
        method: 'DELETE',
        headers: authedHeaders,
      });
      expect(delVoteRes.status).toBe(500);

      const reportIncRes = await fetch(`${baseUrl}/api/v1/incidents/MD-7K3Q9XTB/reports`, {
        method: 'POST',
        headers: authedHeaders,
        body: JSON.stringify({ reason: 'spam' }),
      });
      expect(reportIncRes.status).toBe(500);

      const commentRes = await fetch(`${baseUrl}/api/v1/incidents/MD-7K3Q9XTB/comments`, {
        method: 'POST',
        headers: authedHeaders,
        body: JSON.stringify({
          type: 'info',
          body: 'Confirmed road issue in this area earlier today.',
          captchaToken: 'valid-captcha',
        }),
      });
      expect(commentRes.status).toBe(500);

      const reportCommentRes = await fetch(
        `${baseUrl}/api/v1/comments/${commentId.toString()}/reports`,
        {
          method: 'POST',
          headers: authedHeaders,
          body: JSON.stringify({ reason: 'inappropriate' }),
        },
      );
      expect(reportCommentRes.status).toBe(500);

      const quickEditRes = await fetch(`${baseUrl}/api/v1/incidents/MD-7K3Q9XTB`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': '203.0.113.55',
        },
        body: JSON.stringify({
          secret: 'VALID-SECRET-TOKEN',
          title: 'Updated title still valid length here',
        }),
      });
      expect(quickEditRes.status).toBe(500);

      const trackRes = await fetch(`${baseUrl}/api/v1/track`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': '203.0.113.55',
        },
        body: JSON.stringify({
          trackingId: 'MD-7K3Q9XTB',
          secret: 'VALID-SECRET-TOKEN',
        }),
      });
      expect(trackRes.status).toBe(500);
    });

    expect(geoSpy).not.toHaveBeenCalled();
    expect(slidingSpy).not.toHaveBeenCalled();
    expect(incidentCreateSpy).not.toHaveBeenCalled();
    expect(incidentFindOneSpy).not.toHaveBeenCalled();
    expect(voteSpy).not.toHaveBeenCalled();
    expect(reportCreateSpy).not.toHaveBeenCalled();
    expect(commentCreateSpy).not.toHaveBeenCalled();
  });
});
