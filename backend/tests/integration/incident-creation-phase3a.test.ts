import http from 'node:http';
import type { AddressInfo } from 'node:net';
import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { parseEnvironment } from '../../src/config/env.js';
import { CATEGORIES, RATE } from '../../src/constants/index.js';
import { setTurnstileVerifierForTests } from '../../src/lib/captcha.js';
import { generateBrowserToken, sha256Hex } from '../../src/lib/crypto.js';
import {
  InMemoryRateLimitStore,
  resetDevInMemoryRateLimitStore,
  setRateLimitStoreForTests,
} from '../../src/lib/ratelimit.js';
import { computeIncidentContentHash, normalizeContentText } from '../../src/lib/text-rules.js';
import { AbuseSignalModel } from '../../src/models/abuse_signals.model.js';
import { ActorModel } from '../../src/models/actors.model.js';
import { IncidentModel } from '../../src/models/incidents.model.js';
import { SettingModel } from '../../src/models/settings.model.js';
import { internalError } from '../../src/utils/errors.js';

const ORIGIN = 'http://localhost:5173';
const ACTOR_SECRET = 'phase3a-test-actor-hmac-secret-0123456789abcdef';
const IP_SECRET = 'phase3a-test-ip-hmac-secret-0123456789abcdef';

function createQueryChain<T>(value: T) {
  const promise = Promise.resolve(value);
  const query = {
    lean: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(value),
    then: promise.then.bind(promise),
  };
  return query;
}

function extractActorCookie(res: Response): string | undefined {
  const headerObj = res.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies =
    typeof headerObj.getSetCookie === 'function'
      ? headerObj.getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie') as string]
        : [];

  for (const rawCookie of setCookies) {
    const firstPart = rawCookie.split(';')[0]?.trim();
    if (firstPart && firstPart.startsWith('mdb_actor=')) {
      return firstPart;
    }
  }
  return undefined;
}

function buildValidPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Snatching near Farmgate footbridge',
    description:
      'Two people on a dark motorcycle snatched a commuter phone near the south steps.',
    category: CATEGORIES[0],
    incidentAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    location: { lat: 23.75612, lng: 90.38714 },
    roadName: 'Kazi Nazrul Islam Ave',
    areaName: 'Farmgate',
    upazila: 'Tejgaon',
    district: 'Dhaka',
    safetyTip: 'Keep phones secured away from curbside traffic.',
    captchaToken: 'valid-captcha',
    ...overrides,
  };
}

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const env = parseEnvironment({
    NODE_ENV: 'test',
    PORT: '5000',
    DB_NAME: 'mamladibe_phase3a_test',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/mamladibe_phase3a_test',
    ALLOWED_ORIGINS: ORIGIN,
    LOG_LEVEL: 'silent',
    ACTOR_HMAC_SECRET: ACTOR_SECRET,
    IP_HMAC_SECRET: IP_SECRET,
    TURNSTILE_SECRET: 'turnstile-test-secret',
  });

  const app = createApp(env);
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

describe('Phase 3A: Incident creation, validation, duplicate detection & quota', () => {
  const savedEnv = {
    ACTOR_HMAC_SECRET: process.env.ACTOR_HMAC_SECRET,
    IP_HMAC_SECRET: process.env.IP_HMAC_SECRET,
    TURNSTILE_SECRET: process.env.TURNSTILE_SECRET,
  };

  let createdDocs: Array<Record<string, unknown>>;
  let turnstileMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ACTOR_HMAC_SECRET = ACTOR_SECRET;
    process.env.IP_HMAC_SECRET = IP_SECRET;
    process.env.TURNSTILE_SECRET = 'turnstile-test-secret';

    resetDevInMemoryRateLimitStore();
    setRateLimitStoreForTests(new InMemoryRateLimitStore());

    turnstileMock = vi.fn((token: string, _remoteIp?: string) => token === 'valid-captcha');
    setTurnstileVerifierForTests(async ({ token, remoteIp }) =>
      Boolean(turnstileMock(token, remoteIp)),
    );

    Object.defineProperty(mongoose.connection, 'readyState', {
      configurable: true,
      get: () => 1,
    });

    vi.spyOn(SettingModel, 'find').mockReturnValue(createQueryChain([]) as never);
    vi.spyOn(ActorModel, 'findOneAndUpdate').mockImplementation(((
      filter: { actorId?: string },
    ) =>
      createQueryChain({
        _id: new mongoose.Types.ObjectId(),
        actorId: filter?.actorId ?? sha256Hex('actor'),
        incidentCount: 0,
        commentCount: 0,
        restricted: false,
        restrictedUntil: null,
        notes: '',
      })) as never);

    vi.spyOn(AbuseSignalModel, 'create').mockImplementation((async (doc: unknown) => doc) as never);
    vi.spyOn(AbuseSignalModel, 'countDocuments').mockReturnValue(createQueryChain(0) as never);

    createdDocs = [];
    vi.spyOn(IncidentModel, 'exists').mockImplementation((async (filter: {
      actorId?: string;
      contentHash?: string;
      createdAt?: { $gte?: Date };
    }) => {
      const hit = createdDocs.find(
        (d) =>
          d.actorId === filter?.actorId &&
          d.contentHash === filter?.contentHash &&
          (!filter?.createdAt?.$gte || (d.createdAt as Date) >= filter.createdAt.$gte),
      );
      return hit ? { _id: hit._id } : null;
    }) as never);

    vi.spyOn(IncidentModel, 'create').mockImplementation((async (doc: Record<string, unknown>) => {
      const now = new Date();
      const stored = {
        ...doc,
        _id: new mongoose.Types.ObjectId(),
        voteCount: 0,
        commentCount: 0,
        reportCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      createdDocs.push(stored);
      return {
        ...stored,
        toObject: () => stored,
      };
    }) as never);
  });

  afterEach(() => {
    setTurnstileVerifierForTests(null);
    setRateLimitStoreForTests(null);
    resetDevInMemoryRateLimitStore();
    vi.restoreAllMocks();

    if (savedEnv.ACTOR_HMAC_SECRET === undefined) {
      delete process.env.ACTOR_HMAC_SECRET;
    } else {
      process.env.ACTOR_HMAC_SECRET = savedEnv.ACTOR_HMAC_SECRET;
    }
    if (savedEnv.IP_HMAC_SECRET === undefined) {
      delete process.env.IP_HMAC_SECRET;
    } else {
      process.env.IP_HMAC_SECRET = savedEnv.IP_HMAC_SECRET;
    }
    if (savedEnv.TURNSTILE_SECRET === undefined) {
      delete process.env.TURNSTILE_SECRET;
    } else {
      process.env.TURNSTILE_SECRET = savedEnv.TURNSTILE_SECRET;
    }
  });

  it('1) creates valid incidents, rounds coords to 5 decimals in GeoJSON [lng,lat], enforces Bangladesh boundary corners, and hides sensitive fields', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': '203.0.113.10',
        },
        body: JSON.stringify(
          buildValidPayload({
            location: { lat: 23.75123456, lng: 90.38123456 },
          }),
        ),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        credentials: { trackingId: string; secret: string };
        incident: Record<string, unknown>;
      };
      expect(body.credentials.trackingId).toMatch(/^MD-/);
      expect(body.credentials.secret.length).toBeGreaterThanOrEqual(10);
      expect(body.incident.trackingId).toBe(body.credentials.trackingId);
      expect(body.incident.source).toBe('public');
      expect(body.incident.location).toEqual({ lat: 23.75123, lng: 90.38123 });
      expect(body.incident.secretHash).toBeUndefined();
      expect(body.incident.actorId).toBeUndefined();
      expect(body.incident.contentHash).toBeUndefined();
      expect(body.incident.ipHash).toBeUndefined();

      expect(createdDocs).toHaveLength(1);
      expect(createdDocs[0].location).toEqual({
        type: 'Point',
        coordinates: [90.38123, 23.75123],
      });
      expect(createdDocs[0].status).toBe('published');
      expect(typeof createdDocs[0].secretHash).toBe('string');
      expect(createdDocs[0].secretHash).not.toBe(body.credentials.secret);

      // Exact Bangladesh bounding-box corners succeed
      const swRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': '203.0.113.11',
        },
        body: JSON.stringify(
          buildValidPayload({
            title: 'Southwest boundary check near coast',
            location: { lat: 20.55, lng: 88.0 },
          }),
        ),
      });
      expect(swRes.status).toBe(201);

      const neRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': '203.0.113.12',
        },
        body: JSON.stringify(
          buildValidPayload({
            title: 'Northeast boundary check near Sylhet',
            location: { lat: 26.7, lng: 92.7 },
          }),
        ),
      });
      expect(neRes.status).toBe(201);
    });
  });

  it('2) rejects invalid payloads before CAPTCHA or quota consumption so actor retains full 5/24h quota', async () => {
    await withServer(async (baseUrl) => {
      const fixedCookie = `mdb_actor=${generateBrowserToken()}`;
      const invalidPayloads = [
        buildValidPayload({
          description: 'Reach out on 01711223344 or https://example.com for footage',
        }),
        buildValidPayload({ district: 'Dhaka contact@example.com' }),
        buildValidPayload({ upazila: 'Mirpur http://bad.example' }),
        buildValidPayload({ unknownExtraKey: 'should-fail-strict' }),
        buildValidPayload({ category: 'alien_sighting' }),
        buildValidPayload({ location: { lat: 20.549, lng: 90.4 } }),
        buildValidPayload({ location: { lat: 26.701, lng: 90.4 } }),
        buildValidPayload({ location: { lat: 23.8, lng: 87.999 } }),
        buildValidPayload({ location: { lat: 23.8, lng: 92.701 } }),
        buildValidPayload({ incidentAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() }),
        buildValidPayload({
          incidentAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        buildValidPayload({ title: ' ab\u202Ecd ' }),
      ];

      for (const payload of invalidPayloads) {
        const res = await fetch(`${baseUrl}/api/v1/incidents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            Cookie: fixedCookie,
            'X-Forwarded-For': '203.0.113.21',
          },
          body: JSON.stringify(payload),
        });
        expect(res.status).toBe(400);
        const errBody = (await res.json()) as {
          error: { code: string; message: string; details?: { reason?: string } };
        };
        expect(errBody.error.code).toBe('VALIDATION_ERROR');
      }

      // Check exact PRD contact-info wording explicitly
      const contactRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: fixedCookie,
          'X-Forwarded-For': '203.0.113.21',
        },
        body: JSON.stringify(
          buildValidPayload({ description: 'Call 01711223344 near the crossing.' }),
        ),
      });
      expect(contactRes.status).toBe(400);
      const contactErr = (await contactRes.json()) as {
        error: { code: string; message: string; details?: { reason?: string } };
      };
      expect(contactErr.error.details?.reason).toBe('CONTACT_INFO_NOT_ALLOWED');
      expect(contactErr.error.message).toMatch(/Remove personal contact details/i);

      expect(turnstileMock).not.toHaveBeenCalled();
      expect(createdDocs).toHaveLength(0);

      // Actor must STILL have all 5 quota slots available
      for (let i = 1; i <= RATE.INCIDENTS_PER_ACTOR_24H; i += 1) {
        const okRes = await fetch(`${baseUrl}/api/v1/incidents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            Cookie: fixedCookie,
            'X-Forwarded-For': '203.0.113.21',
          },
          body: JSON.stringify(
            buildValidPayload({ title: `Valid report number ${i} after invalid attempts` }),
          ),
        });
        expect(okRes.status).toBe(201);
      }

      const sixthRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: fixedCookie,
          'X-Forwarded-For': '203.0.113.21',
        },
        body: JSON.stringify(buildValidPayload({ title: 'Sixth valid report hits 429' })),
      });
      expect(sixthRes.status).toBe(429);
    });
  });

  it('3) returns 428 CAPTCHA_REQUIRED on missing/empty/invalid token and never burns quota on CAPTCHA failures or 503 outages', async () => {
    await withServer(async (baseUrl) => {
      const fixedCookie = `mdb_actor=${generateBrowserToken()}`;
      const missingTokenPayload = buildValidPayload();
      delete (missingTokenPayload as Record<string, unknown>).captchaToken;

      const missingRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: fixedCookie,
          'X-Forwarded-For': '203.0.113.31',
        },
        body: JSON.stringify(missingTokenPayload),
      });
      expect(missingRes.status).toBe(428);
      expect(((await missingRes.json()) as { error: { code: string } }).error.code).toBe(
        'CAPTCHA_REQUIRED',
      );

      const emptyRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: fixedCookie,
          'X-Forwarded-For': '203.0.113.31',
        },
        body: JSON.stringify(buildValidPayload({ captchaToken: '   ' })),
      });
      expect(emptyRes.status).toBe(428);

      const invalidRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: fixedCookie,
          'X-Forwarded-For': '203.0.113.31',
        },
        body: JSON.stringify(buildValidPayload({ captchaToken: 'bad-captcha' })),
      });
      expect(invalidRes.status).toBe(428);

      // 3 captcha_failed signals recorded so far
      expect(AbuseSignalModel.create).toHaveBeenCalledTimes(3);
      for (const call of vi.mocked(AbuseSignalModel.create).mock.calls) {
        expect((call[0] as { type: string }).type).toBe('captcha_failed');
      }

      // Simulated Turnstile 503 outage must NOT record captcha_failed or consume quota
      setTurnstileVerifierForTests(async () => {
        throw internalError('CAPTCHA verification service unavailable.', 503);
      });
      const outageRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: fixedCookie,
          'X-Forwarded-For': '203.0.113.31',
        },
        body: JSON.stringify(buildValidPayload({ captchaToken: 'valid-captcha' })),
      });
      expect(outageRes.status).toBe(503);
      expect(AbuseSignalModel.create).toHaveBeenCalledTimes(3);
      expect(createdDocs).toHaveLength(0);

      // Restore verifier: actor still creates all 5 incidents cleanly
      setTurnstileVerifierForTests(async ({ token }) => token === 'valid-captcha');
      for (let i = 1; i <= RATE.INCIDENTS_PER_ACTOR_24H; i += 1) {
        const res = await fetch(`${baseUrl}/api/v1/incidents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            Cookie: fixedCookie,
            'X-Forwarded-For': '203.0.113.31',
          },
          body: JSON.stringify(
            buildValidPayload({ title: `Post-captcha-failure incident #${i}` }),
          ),
        });
        expect(res.status).toBe(201);
      }
      expect(createdDocs).toHaveLength(5);
    });
  });

  it('4) returns 429 RATE_LIMITED with Retry-After header and rate_limit_hit abuse signal on 6th incident', async () => {
    await withServer(async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': '203.0.113.41',
        },
        body: JSON.stringify(buildValidPayload({ title: 'First quota test incident' })),
      });
      expect(first.status).toBe(201);
      const actorCookie = extractActorCookie(first);
      expect(actorCookie).toBeTruthy();

      for (let i = 2; i <= RATE.INCIDENTS_PER_ACTOR_24H; i += 1) {
        const res = await fetch(`${baseUrl}/api/v1/incidents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            Cookie: actorCookie as string,
            'X-Forwarded-For': '203.0.113.41',
          },
          body: JSON.stringify(buildValidPayload({ title: `Quota incident #${i}` })),
        });
        expect(res.status).toBe(201);
      }

      const exceeded = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: actorCookie as string,
          'X-Forwarded-For': '203.0.113.41',
        },
        body: JSON.stringify(buildValidPayload({ title: 'Sixth quota incident blocked' })),
      });
      expect(exceeded.status).toBe(429);
      const retryAfter = Number(exceeded.headers.get('retry-after'));
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThan(0);

      const err = (await exceeded.json()) as { error: { code: string } };
      expect(err.error.code).toBe('RATE_LIMITED');
      expect(AbuseSignalModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'rate_limit_hit' }),
      );
    });
  });

  it('5) enforces concurrency safety for 8 parallel unique posts (5 max) and 3 parallel identical posts (1 wins, 0 extra quota burned)', async () => {
    await withServer(async (baseUrl) => {
      // (a) 8 parallel unique requests sharing actor cookie -> strictly 5 persist, 3 return 429
      const uniqueActorCookie = `mdb_actor=${generateBrowserToken()}`;
      const uniqueResponses = await Promise.all(
        Array.from({ length: 8 }, (_, idx) =>
          fetch(`${baseUrl}/api/v1/incidents`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: ORIGIN,
              Cookie: uniqueActorCookie,
              'X-Forwarded-For': '203.0.113.51',
            },
            body: JSON.stringify(
              buildValidPayload({ title: `Concurrent unique incident #${idx + 1}` }),
            ),
          }),
        ),
      );
      const uniqueStatuses = uniqueResponses.map((r) => r.status);
      expect(uniqueStatuses.filter((s) => s === 201)).toHaveLength(5);
      expect(uniqueStatuses.filter((s) => s === 429)).toHaveLength(3);
      expect(createdDocs).toHaveLength(5);

      // (b) 3 parallel IDENTICAL requests with slow DB create -> 1 wins (201), 2 get 409, and 4 slots remain
      createdDocs = [];
      const baseCreate = vi.mocked(IncidentModel.create).getMockImplementation()!;
      vi.mocked(IncidentModel.create).mockImplementation((async (doc: Record<string, unknown>) => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return baseCreate(doc as never);
      }) as never);

      const dupActorCookie = `mdb_actor=${generateBrowserToken()}`;
      const samePayload = buildValidPayload({
        title: 'Concurrent duplicate race incident test',
        description: 'Same body submitted three times simultaneously to verify NX dedup lock.',
      });
      const dupResponses = await Promise.all(
        Array.from({ length: 3 }, () =>
          fetch(`${baseUrl}/api/v1/incidents`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: ORIGIN,
              Cookie: dupActorCookie,
              'X-Forwarded-For': '203.0.113.52',
            },
            body: JSON.stringify(samePayload),
          }),
        ),
      );
      const dupStatuses = dupResponses.map((r) => r.status);
      expect(dupStatuses.filter((s) => s === 201)).toHaveLength(1);
      expect(dupStatuses.filter((s) => s === 409)).toHaveLength(2);
      expect(createdDocs).toHaveLength(1);

      // Remaining 4 quota slots must still succeed for dupActorCookie
      for (let i = 1; i <= 4; i += 1) {
        const res = await fetch(`${baseUrl}/api/v1/incidents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            Cookie: dupActorCookie,
            'X-Forwarded-For': '203.0.113.52',
          },
          body: JSON.stringify(
            buildValidPayload({ title: `Remaining quota slot #${i} after concurrent dup` }),
          ),
        });
        expect(res.status).toBe(201);
      }
      expect(createdDocs).toHaveLength(5);
    });
  });

  it('6 & 7) detects 24h duplicates per-actor using exact PRD contentHash (normalized title + \\n + description, excluding safetyTip)', async () => {
    await withServer(async (baseUrl) => {
      const actorACookie = `mdb_actor=${generateBrowserToken()}`;
      const actorBCookie = `mdb_actor=${generateBrowserToken()}`;

      const rawTitle = '  Pickpocket near Farmgate bus bay\u202E  ';
      const rawDescription =
        'Wallet stolen\r\n\r\n\r\nwhile boarding bus near east corner around evening rush hour.';

      const firstRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: actorACookie,
          'X-Forwarded-For': '203.0.113.61',
        },
        body: JSON.stringify(
          buildValidPayload({
            title: rawTitle,
            description: rawDescription,
            safetyTip: 'First safety tip advice here.',
          }),
        ),
      });
      expect(firstRes.status).toBe(201);
      expect(createdDocs).toHaveLength(1);

      // Exact PRD contentHash: sha256(normalizedTitle + '\n' + normalizedDescription), ignoring safetyTip
      const expectedHash = sha256Hex(
        `${normalizeContentText(rawTitle)}\n${normalizeContentText(rawDescription)}`,
      );
      expect(createdDocs[0].contentHash).toBe(expectedHash);
      expect(computeIncidentContentHash({ title: rawTitle, description: rawDescription })).toBe(
        expectedHash,
      );

      // Same actor with formatting differences & changed safetyTip -> 409 DUPLICATE_ACTION
      const dupRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: actorACookie,
          'X-Forwarded-For': '203.0.113.61',
        },
        body: JSON.stringify(
          buildValidPayload({
            title: 'Pickpocket near Farmgate bus bay',
            description:
              'Wallet stolen\n\nwhile boarding bus near east corner around evening rush hour.',
            safetyTip: 'Completely different safety tip should NOT bypass duplicate check.',
          }),
        ),
      });
      expect(dupRes.status).toBe(409);
      const dupErr = (await dupRes.json()) as { error: { code: string } };
      expect(dupErr.error.code).toBe('DUPLICATE_ACTION');
      expect(AbuseSignalModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'duplicate_incident' }),
      );

      // Different actor CAN report the exact same title + description (201)
      const otherActorRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: actorBCookie,
          'X-Forwarded-For': '203.0.113.62',
        },
        body: JSON.stringify(
          buildValidPayload({
            title: rawTitle,
            description: rawDescription,
            safetyTip: 'Another eyewitness safety tip.',
          }),
        ),
      });
      expect(otherActorRes.status).toBe(201);
      expect(createdDocs).toHaveLength(2);
    });
  });

  it('8) never leaks or stores raw IP addresses and fails closed when IP_HMAC_SECRET is missing', async () => {
    await withServer(async (baseUrl) => {
      const rawIp = '198.51.100.77';

      // Trigger captcha_failed abuse signal then a valid incident
      const failRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': rawIp,
        },
        body: JSON.stringify(buildValidPayload({ captchaToken: 'bad-captcha' })),
      });
      expect(failRes.status).toBe(428);
      const failText = await failRes.text();
      expect(failText).not.toContain(rawIp);

      const okRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': rawIp,
        },
        body: JSON.stringify(buildValidPayload({ title: 'Privacy check incident report' })),
      });
      expect(okRes.status).toBe(201);
      const okText = await okRes.text();
      expect(okText).not.toContain(rawIp);

      // Check AbuseSignalModel.create received 32-hex daily IP hash, zero raw IPs
      const signalArg = vi.mocked(AbuseSignalModel.create).mock.calls[0]?.[0] as {
        ipHash: string;
      };
      expect(signalArg.ipHash).toMatch(/^[a-f0-9]{32}$/);
      expect(JSON.stringify(vi.mocked(AbuseSignalModel.create).mock.calls)).not.toContain(rawIp);
      expect(JSON.stringify(vi.mocked(ActorModel.findOneAndUpdate).mock.calls)).not.toContain(
        rawIp,
      );
      expect(JSON.stringify(createdDocs)).not.toContain(rawIp);

      // Missing IP_HMAC_SECRET must fail closed (500) before DB writes
      delete process.env.IP_HMAC_SECRET;
      const beforeCount = createdDocs.length;
      const missingSecretRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': rawIp,
        },
        body: JSON.stringify(buildValidPayload({ title: 'Should fail closed without secret' })),
      });
      expect(missingSecretRes.status).toBe(500);
      expect(await missingSecretRes.text()).not.toContain(rawIp);
      expect(createdDocs).toHaveLength(beforeCount);
    });
  });

  it('9) handles DB write failures, validation errors, and 11000 trackingId collisions safely and releases duplicate lock', async () => {
    await withServer(async (baseUrl) => {
      const actorCookie = `mdb_actor=${generateBrowserToken()}`;
      const defaultCreate = vi.mocked(IncidentModel.create).getMockImplementation()!;

      // (a) Transient DB error returns generic 500 and releases dedup lock for retry
      vi.mocked(IncidentModel.create).mockRejectedValueOnce(
        new Error('mongodb+srv://dbuser:supersecret@cluster.mongodb.net/fail') as never,
      );
      const retryPayload = buildValidPayload({
        title: 'Incident surviving transient DB failure',
      });

      const failedRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: actorCookie,
          'X-Forwarded-For': '203.0.113.81',
        },
        body: JSON.stringify(retryPayload),
      });
      expect(failedRes.status).toBe(500);
      const failBodyText = await failedRes.text();
      expect(failBodyText).not.toContain('supersecret');
      expect(failBodyText).not.toContain('mongodb+srv');
      expect(JSON.parse(failBodyText)).toMatchObject({
        error: { code: 'INTERNAL' },
      });

      // Retry IDENTICAL payload immediately succeeds -> duplicate lock was released!
      vi.mocked(IncidentModel.create).mockImplementation(defaultCreate);
      const recoveredRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: actorCookie,
          'X-Forwarded-For': '203.0.113.81',
        },
        body: JSON.stringify(retryPayload),
      });
      expect(recoveredRes.status).toBe(201);

      // (b) Single 11000 trackingId collision recovers cleanly on retry (201)
      vi.mocked(IncidentModel.create).mockRejectedValueOnce(
        Object.assign(new Error('E11000 duplicate key error collection: incidents'), {
          code: 11000,
        }) as never,
      );
      const singleCollisionRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: actorCookie,
          'X-Forwarded-For': '203.0.113.81',
        },
        body: JSON.stringify(buildValidPayload({ title: 'Single trackingId collision retry' })),
      });
      expect(singleCollisionRes.status).toBe(201);

      // (c) 5 consecutive 11000 trackingId collisions map to 500 INTERNAL (not 409) & unlock dedup
      for (let i = 0; i < 5; i += 1) {
        vi.mocked(IncidentModel.create).mockRejectedValueOnce(
          Object.assign(new Error('E11000 duplicate key'), { code: 11000 }) as never,
        );
      }
      const fiveCollisionPayload = buildValidPayload({
        title: 'Five consecutive trackingId collisions test',
      });
      const fiveCollisionRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: actorCookie,
          'X-Forwarded-For': '203.0.113.81',
        },
        body: JSON.stringify(fiveCollisionPayload),
      });
      expect(fiveCollisionRes.status).toBe(500);
      expect(((await fiveCollisionRes.json()) as { error: { code: string } }).error.code).toBe(
        'INTERNAL',
      );

      // Same payload retries cleanly afterward
      const afterCollisionRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: actorCookie,
          'X-Forwarded-For': '203.0.113.81',
        },
        body: JSON.stringify(fiveCollisionPayload),
      });
      expect(afterCollisionRes.status).toBe(201);

      // (d) Mongoose ValidationError maps to 400 VALIDATION_ERROR & releases dedup lock
      const valActorCookie = `mdb_actor=${generateBrowserToken()}`;
      const validationErr = new mongoose.Error.ValidationError();
      vi.mocked(IncidentModel.create).mockRejectedValueOnce(validationErr as never);
      const valPayload = buildValidPayload({ title: 'Mongoose ValidationError mapping test' });
      const valRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: valActorCookie,
          'X-Forwarded-For': '203.0.113.82',
        },
        body: JSON.stringify(valPayload),
      });
      expect(valRes.status).toBe(400);
      expect(((await valRes.json()) as { error: { code: string } }).error.code).toBe(
        'VALIDATION_ERROR',
      );

      const afterValidationRetryRes = await fetch(`${baseUrl}/api/v1/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: valActorCookie,
          'X-Forwarded-For': '203.0.113.82',
        },
        body: JSON.stringify(valPayload),
      });
      expect(afterValidationRetryRes.status).toBe(201);
    });
  });
});
