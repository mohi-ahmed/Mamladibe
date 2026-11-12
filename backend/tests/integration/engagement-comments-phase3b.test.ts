import http from 'node:http';
import type { AddressInfo } from 'node:net';
import mongoose, { Types } from 'mongoose';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const envSetup = vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.PORT = '5000';
  process.env.DB_NAME = 'mamladibe_phase3b_test';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/mamladibe_phase3b_test';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
  process.env.LOG_LEVEL = 'silent';
  process.env.ACTOR_HMAC_SECRET = 'phase3b-test-actor-secret-32chars-min';
  process.env.IP_HMAC_SECRET = 'phase3b-test-ip-hmac-secret-32chars-m';
  process.env.SESSION_SECRET = 'phase3b-test-session-secret-32chars';
  process.env.TOTP_ENC_KEY =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  return true;
});

vi.mock('../../src/config/database.js', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(undefined),
  disconnectFromDatabase: vi.fn().mockResolvedValue(undefined),
}));

import { createApp } from '../../src/app.js';
import {
  ACTOR_COOKIE,
  EDIT,
  ERROR_CODES,
  LIMITS,
  PATTERNS,
  RATE,
  RETENTION,
  SETTING_KEYS,
} from '../../src/constants/index.js';
import { setTurnstileVerifierForTests } from '../../src/lib/captcha.js';
import {
  computeActorId,
  computeIpHash,
  generateBrowserToken,
} from '../../src/lib/crypto.js';
import * as ratelimitLib from '../../src/lib/ratelimit.js';
import {
  AbuseSignalModel,
  ActorModel,
  CommentModel,
  DailyQuotaModel,
  IncidentModel,
  ReportModel,
  SettingModel,
  VoteModel,
} from '../../src/models/index.js';
import { createComment } from '../../src/services/comment.service.js';
import type {
  AbuseSignalType,
  ActorRestrictionScope,
  CommentStatus,
  CommentType,
  FlagReason,
  IncidentStatus,
  VoteType,
} from '../../src/types/index.js';

const TEST_ORIGIN = 'http://localhost:5173';
const PUBLISHED_TRACKING_ID = 'MD-ABCD2345';
const SECOND_TRACKING_ID = 'MD-EFGH6789';
const HIDDEN_TRACKING_ID = 'MD-HJKM2345';
const DELETED_TRACKING_ID = 'MD-NPQR6789';

interface IncidentRecord {
  _id: Types.ObjectId;
  trackingId: string;
  status: IncidentStatus;
}

interface CommentRecord {
  _id: Types.ObjectId;
  incidentId: Types.ObjectId;
  actorId: string;
  type: CommentType;
  body: string;
  status: CommentStatus;
  redacted: boolean;
  createdAt: Date;
  deletedAt?: Date;
  purgeAt?: Date;
}

interface DailyQuotaRecord {
  _id: Types.ObjectId;
  actorId: string;
  day: string;
  kind: 'comment';
  count: number;
  expiresAt: Date;
}

interface ActorRecord {
  _id: Types.ObjectId;
  actorId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  restriction?: {
    scope: ActorRestrictionScope[];
    until: Date;
    reason?: string;
  };
}

interface VoteRecord {
  _id: Types.ObjectId;
  incidentId: Types.ObjectId;
  actorId: string;
  type: VoteType;
  createdAt: Date;
  updatedAt: Date;
}

interface ReportRecord {
  _id: Types.ObjectId;
  targetType: 'incident' | 'comment';
  targetId: Types.ObjectId;
  actorId: string;
  reason: FlagReason;
  note?: string;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: Date;
}

interface AbuseSignalRecord {
  ipHash: string;
  actorId?: string;
  type: AbuseSignalType;
  createdAt: Date;
}

interface SettingRecord {
  key: string;
  value: unknown;
}

interface HarnessState {
  incidents: IncidentRecord[];
  comments: CommentRecord[];
  dailyQuotas: DailyQuotaRecord[];
  actors: ActorRecord[];
  votes: VoteRecord[];
  reports: ReportRecord[];
  abuseSignals: AbuseSignalRecord[];
  settings: SettingRecord[];
  failNextVoteUpsertWithE11000: boolean;
}

function makeQueryChain<T>(value: T) {
  return {
    select: vi.fn().mockImplementation(() => makeQueryChain(value)),
    sort: vi.fn().mockImplementation(() => makeQueryChain(value)),
    limit: vi.fn().mockImplementation(() => makeQueryChain(value)),
    lean: vi.fn().mockResolvedValue(value),
  };
}

function matchesId(a: unknown, b: unknown): boolean {
  return String(a) === String(b);
}

function installStatefulMongoMocks(state: HarnessState): void {
  vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);

  vi.spyOn(IncidentModel, 'findOne').mockImplementation(((filter: Record<string, unknown>) => {
    const matched = state.incidents.find((doc) => {
      if (filter.trackingId !== undefined && doc.trackingId !== filter.trackingId) {
        return false;
      }
      if (filter.status !== undefined && doc.status !== filter.status) {
        return false;
      }
      return true;
    });
    return makeQueryChain(matched ?? null);
  }) as never);

  vi.spyOn(IncidentModel, 'exists').mockImplementation((async (filter: Record<string, unknown>) => {
    const matched = state.incidents.find((doc) => {
      if (filter._id !== undefined && !matchesId(doc._id, filter._id)) {
        return false;
      }
      if (filter.status !== undefined && doc.status !== filter.status) {
        return false;
      }
      return true;
    });
    return matched ? { _id: matched._id } : null;
  }) as never);

  vi.spyOn(CommentModel, 'find').mockImplementation(((filter: Record<string, unknown>) => {
    let limitCount = 50;
    const chain = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation((n: number) => {
        limitCount = n;
        return chain;
      }),
      lean: vi.fn().mockImplementation(async () => {
        const statusFilter = filter.status as { $in?: CommentStatus[] } | undefined;
        const allowedStatuses = statusFilter?.$in;
        const orClauses = filter.$or as
          | Array<{ createdAt?: { $lt?: Date } | Date; _id?: { $lt?: Types.ObjectId } }>
          | undefined;

        const filtered = state.comments
          .filter((doc) => {
            if (filter.incidentId !== undefined && !matchesId(doc.incidentId, filter.incidentId)) {
              return false;
            }
            if (allowedStatuses && !allowedStatuses.includes(doc.status)) {
              return false;
            }
            if (orClauses && orClauses.length === 2) {
              const ltCreatedAt = (orClauses[0]?.createdAt as { $lt?: Date } | undefined)?.$lt;
              const eqCreatedAt = orClauses[1]?.createdAt as Date | undefined;
              const ltId = orClauses[1]?._id?.$lt;
              const matchesLtCreated =
                ltCreatedAt !== undefined && doc.createdAt.getTime() < ltCreatedAt.getTime();
              const matchesTieBreaker =
                eqCreatedAt !== undefined &&
                ltId !== undefined &&
                doc.createdAt.getTime() === eqCreatedAt.getTime() &&
                doc._id.toString() < ltId.toString();
              if (!matchesLtCreated && !matchesTieBreaker) {
                return false;
              }
            }
            return true;
          })
          .sort((a, b) => {
            const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
            if (timeDiff !== 0) return timeDiff;
            return b._id.toString().localeCompare(a._id.toString());
          })
          .slice(0, limitCount);

        return filtered.map((doc) => ({ ...doc }));
      }),
    };
    return chain;
  }) as never);

  vi.spyOn(CommentModel, 'create').mockImplementation((async (input: Partial<CommentRecord>) => {
    const doc: CommentRecord = {
      _id: new Types.ObjectId(),
      incidentId: input.incidentId as Types.ObjectId,
      actorId: String(input.actorId),
      type: (input.type ?? 'info') as CommentType,
      body: String(input.body),
      status: (input.status ?? 'published') as CommentStatus,
      redacted: Boolean(input.redacted ?? false),
      createdAt: input.createdAt instanceof Date ? input.createdAt : new Date(),
    };
    state.comments.push(doc);
    return { ...doc };
  }) as never);

  vi.spyOn(CommentModel, 'findOne').mockImplementation(((filter: Record<string, unknown>) => {
    const matched = state.comments.find((doc) => {
      if (filter._id !== undefined && !matchesId(doc._id, filter._id)) {
        return false;
      }
      if (filter.status !== undefined && doc.status !== filter.status) {
        return false;
      }
      return true;
    });
    return makeQueryChain(matched ? { ...matched } : null);
  }) as never);

  vi.spyOn(CommentModel, 'updateOne').mockImplementation(((
    filter: Record<string, unknown>,
    update: { $set?: Partial<CommentRecord> },
  ) => {
    const matched = state.comments.find((doc) => {
      if (filter._id !== undefined && !matchesId(doc._id, filter._id)) {
        return false;
      }
      if (filter.actorId !== undefined && doc.actorId !== filter.actorId) {
        return false;
      }
      if (filter.status !== undefined && doc.status !== filter.status) {
        return false;
      }
      return true;
    });

    if (!matched) {
      return Promise.resolve({ acknowledged: true, matchedCount: 0, modifiedCount: 0 });
    }

    Object.assign(matched, update.$set ?? {});
    return Promise.resolve({ acknowledged: true, matchedCount: 1, modifiedCount: 1 });
  }) as never);

  vi.spyOn(DailyQuotaModel, 'findOne').mockImplementation(((filter: Record<string, unknown>) => {
    const matched = state.dailyQuotas.find(
      (doc) =>
        doc.actorId === filter.actorId &&
        doc.day === filter.day &&
        doc.kind === filter.kind,
    );
    return makeQueryChain(matched ? { ...matched } : null);
  }) as never);

  vi.spyOn(DailyQuotaModel, 'findOneAndUpdate').mockImplementation(((
    filter: Record<string, unknown>,
    update: { $inc?: { count?: number }; $setOnInsert?: { expiresAt?: Date } },
  ) => {
    const existing = state.dailyQuotas.find(
      (doc) =>
        doc.actorId === filter.actorId &&
        doc.day === filter.day &&
        doc.kind === filter.kind,
    );
    const ltCap = (filter.count as { $lt?: number } | undefined)?.$lt;
    const incAmount = update.$inc?.count ?? 1;

    if (existing) {
      if (typeof ltCap === 'number' && existing.count >= ltCap) {
        const dupError = Object.assign(
          new Error('E11000 duplicate key error collection: daily_quotas'),
          { code: 11000 },
        );
        return {
          lean: vi.fn().mockRejectedValue(dupError),
        };
      }
      existing.count += incAmount;
      return makeQueryChain({ ...existing });
    }

    const created: DailyQuotaRecord = {
      _id: new Types.ObjectId(),
      actorId: String(filter.actorId),
      day: String(filter.day),
      kind: 'comment',
      count: incAmount,
      expiresAt: update.$setOnInsert?.expiresAt ?? new Date(),
    };
    state.dailyQuotas.push(created);
    return makeQueryChain({ ...created });
  }) as never);

  vi.spyOn(ActorModel, 'findOneAndUpdate').mockImplementation(((
    filter: Record<string, unknown>,
    update: {
      $set?: { lastSeenAt?: Date };
      $setOnInsert?: { actorId?: string; firstSeenAt?: Date };
    },
  ) => {
    let existing = state.actors.find((doc) => doc.actorId === filter.actorId);
    if (!existing) {
      existing = {
        _id: new Types.ObjectId(),
        actorId: String(update.$setOnInsert?.actorId ?? filter.actorId),
        firstSeenAt: update.$setOnInsert?.firstSeenAt ?? new Date(),
        lastSeenAt: update.$set?.lastSeenAt ?? new Date(),
      };
      state.actors.push(existing);
    } else if (update.$set?.lastSeenAt) {
      existing.lastSeenAt = update.$set.lastSeenAt;
    }
    return makeQueryChain({ ...existing });
  }) as never);

  vi.spyOn(SettingModel, 'find').mockImplementation(((filter: Record<string, unknown>) => {
    const keys = (filter.key as { $in?: string[] } | undefined)?.$in;
    const rows = keys
      ? state.settings.filter((s) => keys.includes(s.key))
      : state.settings;
    return makeQueryChain(rows.map((s) => ({ ...s })));
  }) as never);

  vi.spyOn(VoteModel, 'findOneAndUpdate').mockImplementation(((
    filter: Record<string, unknown>,
    update: {
      $set?: { type?: VoteType; updatedAt?: Date };
      $setOnInsert?: { createdAt?: Date };
    },
  ) => {
    if (state.failNextVoteUpsertWithE11000) {
      state.failNextVoteUpsertWithE11000 = false;
      const err = Object.assign(
        new Error('E11000 duplicate key error collection: votes'),
        { code: 11000 },
      );
      return Promise.reject(err);
    }

    const existing = state.votes.find(
      (doc) =>
        matchesId(doc.incidentId, filter.incidentId) &&
        doc.actorId === filter.actorId,
    );

    if (existing) {
      if (update.$set?.type) existing.type = update.$set.type;
      if (update.$set?.updatedAt) existing.updatedAt = update.$set.updatedAt;
      return Promise.resolve({ ...existing });
    }

    const created: VoteRecord = {
      _id: new Types.ObjectId(),
      incidentId: filter.incidentId as Types.ObjectId,
      actorId: String(filter.actorId),
      type: update.$set?.type ?? 'support',
      createdAt: update.$setOnInsert?.createdAt ?? new Date(),
      updatedAt: update.$set?.updatedAt ?? new Date(),
    };
    state.votes.push(created);
    return Promise.resolve({ ...created });
  }) as never);

  vi.spyOn(VoteModel, 'deleteOne').mockImplementation((async (filter: Record<string, unknown>) => {
    const idx = state.votes.findIndex(
      (doc) =>
        matchesId(doc.incidentId, filter.incidentId) &&
        doc.actorId === filter.actorId,
    );
    if (idx === -1) {
      return { acknowledged: true, deletedCount: 0 };
    }
    state.votes.splice(idx, 1);
    return { acknowledged: true, deletedCount: 1 };
  }) as never);

  vi.spyOn(VoteModel, 'aggregate').mockImplementation((async (
    pipeline: Array<{ $match?: { incidentId?: Types.ObjectId } }>,
  ) => {
    const matchIncidentId = pipeline[0]?.$match?.incidentId;
    const counts = new Map<VoteType, number>();
    for (const vote of state.votes) {
      if (matchIncidentId && !matchesId(vote.incidentId, matchIncidentId)) {
        continue;
      }
      counts.set(vote.type, (counts.get(vote.type) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([type, count]) => ({
      _id: type,
      count,
    }));
  }) as never);

  vi.spyOn(ReportModel, 'create').mockImplementation(((input: Partial<ReportRecord>) => {
    const duplicate = state.reports.some(
      (doc) =>
        doc.targetType === input.targetType &&
        matchesId(doc.targetId, input.targetId) &&
        doc.actorId === input.actorId,
    );
    if (duplicate) {
      return Promise.reject(
        Object.assign(new Error('E11000 duplicate key error collection: reports'), {
          code: 11000,
        }),
      );
    }
    const created: ReportRecord = {
      _id: new Types.ObjectId(),
      targetType: input.targetType as 'incident' | 'comment',
      targetId: input.targetId as Types.ObjectId,
      actorId: String(input.actorId),
      reason: input.reason as FlagReason,
      ...(input.note ? { note: input.note } : {}),
      status: 'open',
      createdAt: input.createdAt instanceof Date ? input.createdAt : new Date(),
    };
    state.reports.push(created);
    return Promise.resolve({ ...created });
  }) as never);

  vi.spyOn(ReportModel, 'countDocuments').mockImplementation((async (filter: Record<string, unknown>) => {
    return state.reports.filter(
      (doc) =>
        doc.targetType === filter.targetType &&
        matchesId(doc.targetId, filter.targetId),
    ).length;
  }) as never);

  vi.spyOn(AbuseSignalModel, 'create').mockImplementation((async (input: {
    ipHash: string;
    actorId?: string;
    type: AbuseSignalType;
  }) => {
    const created: AbuseSignalRecord = {
      ipHash: input.ipHash,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      type: input.type,
      createdAt: new Date(),
    };
    state.abuseSignals.push(created);
    return created;
  }) as never);

  vi.spyOn(AbuseSignalModel, 'countDocuments').mockImplementation((async (
    filter: Record<string, unknown>,
  ) => {
    const cutoff = (filter.createdAt as { $gte?: Date } | undefined)?.$gte;
    return state.abuseSignals.filter((sig) => {
      if (filter.ipHash !== undefined && sig.ipHash !== filter.ipHash) {
        return false;
      }
      if (cutoff && sig.createdAt.getTime() < cutoff.getTime()) {
        return false;
      }
      return true;
    }).length;
  }) as never);
}

function makeActorCookie() {
  const token = generateBrowserToken();
  const actorId = computeActorId(token, process.env.ACTOR_HMAC_SECRET as string);
  return {
    token,
    actorId,
    cookieHeader: `${ACTOR_COOKIE.name}=${token}`,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function apiJson(
  baseUrl: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  options: {
    cookie?: string;
    ip?: string;
    body?: unknown;
  } = {},
): Promise<{ status: number; headers: Headers; body: any }> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    headers.Origin = TEST_ORIGIN;
  }
  if (options.cookie) {
    headers.Cookie = options.cookie;
  }
  if (options.ip) {
    headers['X-Forwarded-For'] = options.ip;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
}

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = createApp({ allowedOrigins: [TEST_ORIGIN] });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe('Phase 3B integration: comments, votes, flags, quotas, cooldowns, CAPTCHA, concurrency & privacy', () => {
  let state: HarnessState;
  let publishedIncidentId: Types.ObjectId;
  let secondIncidentId: Types.ObjectId;
  let hiddenIncidentId: Types.ObjectId;
  let deletedIncidentId: Types.ObjectId;

  beforeEach(() => {
    expect(envSetup).toBe(true);
    ratelimitLib.setRateLimitStoreForTests(new ratelimitLib.InMemoryRateLimitStore());
    setTurnstileVerifierForTests(async ({ token }) => token === 'valid-turnstile-token');

    publishedIncidentId = new Types.ObjectId();
    secondIncidentId = new Types.ObjectId();
    hiddenIncidentId = new Types.ObjectId();
    deletedIncidentId = new Types.ObjectId();

    state = {
      incidents: [
        { _id: publishedIncidentId, trackingId: PUBLISHED_TRACKING_ID, status: 'published' },
        { _id: secondIncidentId, trackingId: SECOND_TRACKING_ID, status: 'published' },
        { _id: hiddenIncidentId, trackingId: HIDDEN_TRACKING_ID, status: 'hidden' },
        { _id: deletedIncidentId, trackingId: DELETED_TRACKING_ID, status: 'deleted' },
      ],
      comments: [],
      dailyQuotas: [],
      actors: [],
      votes: [],
      reports: [],
      abuseSignals: [],
      settings: [
        { key: SETTING_KEYS.FREEZE_POSTING, value: false },
        { key: SETTING_KEYS.FREEZE_COMMENTS, value: false },
      ],
      failNextVoteUpsertWithE11000: false,
    };

    installStatefulMongoMocks(state);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    ratelimitLib.setRateLimitStoreForTests(null);
    setTurnstileVerifierForTests(null);
  });

  afterAll(() => {
    ratelimitLib.setRateLimitStoreForTests(null);
    setTurnstileVerifierForTests(null);
  });

  describe('1. Successful operations, normalization, XSS handling & visibility semantics', () => {
    it('creates comments keeping Bangla ZWJ/ZWNJ & raw text, lists published/hidden/omits deleted with cursor paging, serves no-store quota, self-deletes, votes & reports', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-11T10:00:00.000Z'));

      await withServer(async (baseUrl) => {
        const owner = makeActorCookie();
        const reader = makeActorCookie();

        // Bangla text with U+200D (ZWJ) and literal <script> payload stored verbatim without stripping
        const banglaAndScriptBody =
          'র\u200D্যাব এলাকা <script>alert(1)</script> সতর্ক থাকুন';

        const c1Res = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
          {
            cookie: owner.cookieHeader,
            ip: '203.0.113.10',
            body: { type: 'experience', body: banglaAndScriptBody },
          },
        );

        expect(c1Res.status).toBe(201);
        expect(c1Res.body.comment).toMatchObject({
          type: 'experience',
          body: banglaAndScriptBody,
          placeholder: false,
          redacted: false,
          mine: true,
        });
        expect(c1Res.body.comment).not.toHaveProperty('actorId');
        expect(c1Res.body.quota).toEqual({
          commentsLeft: RATE.COMMENTS_PER_ACTOR_PER_DAY - 1,
          resetsAt: '2026-11-11T18:00:00.000Z',
        });

        // Advance 31s so owner can post second comment (will be hidden later) & third (will be deleted later)
        vi.advanceTimersByTime(31_000);
        const c2Res = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
          {
            cookie: owner.cookieHeader,
            body: { type: 'correction', body: 'Official gate opened after checkpoint.' },
          },
        );
        expect(c2Res.status).toBe(201);

        vi.advanceTimersByTime(31_000);
        const c3Res = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
          {
            cookie: owner.cookieHeader,
            body: { type: 'info', body: 'Temporary duplicate remark I will remove.' },
          },
        );
        expect(c3Res.status).toBe(201);

        // Simulate moderator hiding comment #2 and owner deleting comment #3 within 15 minutes
        const hiddenTarget = state.comments.find(
          (c) => c._id.toString() === c2Res.body.comment.id,
        );
        expect(hiddenTarget).toBeDefined();
        hiddenTarget!.status = 'hidden';

        const deleteRes = await apiJson(
          baseUrl,
          'DELETE',
          `/api/v1/comments/${c3Res.body.comment.id}`,
          { cookie: owner.cookieHeader },
        );
        expect(deleteRes.status).toBe(200);
        expect(deleteRes.body).toEqual({ deleted: true });

        const deletedRecord = state.comments.find(
          (c) => c._id.toString() === c3Res.body.comment.id,
        );
        expect(deletedRecord?.status).toBe('deleted');
        expect(deletedRecord?.deletedAt).toBeInstanceOf(Date);
        expect(deletedRecord?.purgeAt).toEqual(
          new Date(
            deletedRecord!.deletedAt!.getTime() +
              RETENTION.SOFT_DELETE_DAYS * 86400 * 1000,
          ),
        );

        // Deleted comments MUST STILL count toward daily quota (FR-13.4); GET /me/quota uses Cache-Control: no-store
        const quotaRes = await apiJson(baseUrl, 'GET', '/api/v1/me/quota', {
          cookie: owner.cookieHeader,
        });
        expect(quotaRes.status).toBe(200);
        expect(quotaRes.headers.get('cache-control')).toBe('no-store');
        expect(quotaRes.body).toEqual({
          commentsLeft: RATE.COMMENTS_PER_ACTOR_PER_DAY - 3,
          limit: RATE.COMMENTS_PER_ACTOR_PER_DAY,
          resetsAt: '2026-11-11T18:00:00.000Z',
        });

        // Public comment listing with cursor pagination (limit=1):
        // - Returns hidden comment placeholder with body=null, mine=false
        // - Returns published comment with mine=false for reader and true for owner
        // - Omits deleted comment entirely
        const page1 = await apiJson(
          baseUrl,
          'GET',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments?limit=1`,
          { cookie: reader.cookieHeader },
        );
        expect(page1.status).toBe(200);
        expect(page1.body.items).toHaveLength(1);
        expect(page1.body.items[0]).toMatchObject({
          id: c2Res.body.comment.id,
          type: 'correction',
          body: null,
          placeholder: true,
          redacted: false,
          mine: false,
        });
        expect(typeof page1.body.nextCursor).toBe('string');

        const page2 = await apiJson(
          baseUrl,
          'GET',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments?limit=10&cursor=${encodeURIComponent(
            page1.body.nextCursor as string,
          )}`,
          { cookie: owner.cookieHeader },
        );
        expect(page2.status).toBe(200);
        expect(page2.body.items).toHaveLength(1);
        expect(page2.body.items[0]).toMatchObject({
          id: c1Res.body.comment.id,
          body: banglaAndScriptBody,
          placeholder: false,
          mine: true,
        });
        expect(page2.body.nextCursor).toBeNull();

        // Votes: create support -> switch dispute -> remove
        const v1 = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/vote`,
          { cookie: owner.cookieHeader, body: { type: 'support' } },
        );
        expect(v1.status).toBe(200);
        expect(v1.body).toEqual({
          counts: { support: 1, dispute: 0 },
          my: { vote: 'support' },
        });

        const v2 = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/vote`,
          { cookie: owner.cookieHeader, body: { type: 'dispute' } },
        );
        expect(v2.status).toBe(200);
        expect(v2.body).toEqual({
          counts: { support: 0, dispute: 1 },
          my: { vote: 'dispute' },
        });

        const vDel = await apiJson(
          baseUrl,
          'DELETE',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/vote`,
          { cookie: owner.cookieHeader },
        );
        expect(vDel.status).toBe(200);
        expect(vDel.body).toEqual({
          counts: { support: 0, dispute: 0 },
          my: { vote: null },
        });

        // Incident report returns total flag count; comment report omits public flag count (FR-13.7)
        const repInc = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/reports`,
          {
            cookie: reader.cookieHeader,
            body: { reason: 'spam', note: 'Multiple identical promotional posts.' },
          },
        );
        expect(repInc.status).toBe(201);
        expect(repInc.body).toEqual({ reported: true, flags: 1 });
        expect(
          state.incidents.find((i) => i.trackingId === PUBLISHED_TRACKING_ID)?.status,
        ).toBe('published');

        const repCom = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/comments/${c1Res.body.comment.id}/reports`,
          { cookie: reader.cookieHeader, body: { reason: 'inappropriate' } },
        );
        expect(repCom.status).toBe(201);
        expect(repCom.body).toEqual({ reported: true });
        expect(repCom.body).not.toHaveProperty('flags');
      });
    });
  });

  describe('2. Validation & hidden/deleted target rejection with zero side effects', () => {
    it('rejects invalid inputs, contact info, line breaks, and non-published targets without touching cooldown, quota, actors, vote, or flag limits', async () => {
      await withServer(async (baseUrl) => {
        const actor = makeActorCookie();
        const publishedCommentId = new Types.ObjectId();
        const hiddenCommentId = new Types.ObjectId();
        const commentOnHiddenIncidentId = new Types.ObjectId();

        state.comments.push(
          {
            _id: publishedCommentId,
            incidentId: publishedIncidentId,
            actorId: actor.actorId,
            type: 'info',
            body: 'Existing published comment body.',
            status: 'published',
            redacted: false,
            createdAt: new Date(),
          },
          {
            _id: hiddenCommentId,
            incidentId: publishedIncidentId,
            actorId: actor.actorId,
            type: 'info',
            body: 'Moderator hid this comment.',
            status: 'hidden',
            redacted: false,
            createdAt: new Date(),
          },
          {
            _id: commentOnHiddenIncidentId,
            incidentId: hiddenIncidentId,
            actorId: actor.actorId,
            type: 'info',
            body: 'Comment under hidden incident.',
            status: 'published',
            redacted: false,
            createdAt: new Date(),
          },
        );

        expect(
          (
            await apiJson(baseUrl, 'POST', '/api/v1/incidents/invalid-id/comments', {
              cookie: actor.cookieHeader,
              body: { type: 'info', body: 'Valid body text' },
            })
          ).status,
        ).toBe(400);

        expect(
          (
            await apiJson(baseUrl, 'DELETE', '/api/v1/comments/not-an-objectid', {
              cookie: actor.cookieHeader,
            })
          ).status,
        ).toBe(400);

        // Too short / too long / extra key / >5 line breaks / post-bidi-strip <5 chars
        for (const badPayload of [
          { type: 'info', body: 'four' },
          { type: 'info', body: 'a'.repeat(LIMITS.COMMENT.max + 1) },
          { type: 'invalid_type', body: 'Valid body text' },
          { type: 'info', body: 'Valid body text', unexpectedField: 'boom' },
          { type: 'info', body: '1\n2\n3\n4\n5\n6\n7' },
          { type: 'info', body: 'ab\u202Acd\u202C' },
        ]) {
          const res = await apiJson(
            baseUrl,
            'POST',
            `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
            { cookie: actor.cookieHeader, body: badPayload },
          );
          expect(res.status).toBe(400);
          expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
        }

        // Personal contact info blocked in comments & flag notes (Bangla phone, ASCII phone, email, URL)
        for (const contactText of [
          'Call me at ০১৭১১-১২৩৪৫৬ right now',
          'Call +880 1711-998877 urgently',
          'Mail tip@example.com for proof',
          'Details at https://example.org/post',
        ]) {
          const badComment = await apiJson(
            baseUrl,
            'POST',
            `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
            { cookie: actor.cookieHeader, body: { type: 'info', body: contactText } },
          );
          expect(badComment.status).toBe(400);
          expect(badComment.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
          expect(badComment.body.error.details.reason).toBe('CONTACT_INFO_NOT_ALLOWED');

          const badFlagNote = await apiJson(
            baseUrl,
            'POST',
            `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/reports`,
            { cookie: actor.cookieHeader, body: { reason: 'inappropriate', note: contactText } },
          );
          expect(badFlagNote.status).toBe(400);
          expect(badFlagNote.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
          expect(badFlagNote.body.error.details.reason).toBe('CONTACT_INFO_NOT_ALLOWED');
        }

        // Hidden / deleted incidents return 404 across list/create/vote/report
        for (const targetTracking of [HIDDEN_TRACKING_ID, DELETED_TRACKING_ID]) {
          expect(
            (await apiJson(baseUrl, 'GET', `/api/v1/incidents/${targetTracking}/comments`))
              .status,
          ).toBe(404);
          expect(
            (
              await apiJson(baseUrl, 'POST', `/api/v1/incidents/${targetTracking}/comments`, {
                cookie: actor.cookieHeader,
                body: { type: 'info', body: 'Valid comment on unavailable target' },
              })
            ).status,
          ).toBe(404);
          expect(
            (
              await apiJson(baseUrl, 'POST', `/api/v1/incidents/${targetTracking}/vote`, {
                cookie: actor.cookieHeader,
                body: { type: 'support' },
              })
            ).status,
          ).toBe(404);
          expect(
            (
              await apiJson(baseUrl, 'DELETE', `/api/v1/incidents/${targetTracking}/vote`, {
                cookie: actor.cookieHeader,
              })
            ).status,
          ).toBe(404);
          expect(
            (
              await apiJson(baseUrl, 'POST', `/api/v1/incidents/${targetTracking}/reports`, {
                cookie: actor.cookieHeader,
                body: { reason: 'spam' },
              })
            ).status,
          ).toBe(404);
        }

        // Hidden comment and comment under hidden parent incident cannot be deleted or reported (404)
        for (const badCommentId of [hiddenCommentId, commentOnHiddenIncidentId]) {
          expect(
            (
              await apiJson(baseUrl, 'DELETE', `/api/v1/comments/${badCommentId.toString()}`, {
                cookie: actor.cookieHeader,
              })
            ).status,
          ).toBe(404);
          expect(
            (
              await apiJson(
                baseUrl,
                'POST',
                `/api/v1/comments/${badCommentId.toString()}/reports`,
                { cookie: actor.cookieHeader, body: { reason: 'spam' } },
              )
            ).status,
          ).toBe(404);
        }

        // Zero side-effects verification: no cooldown lock, zero daily quotas, zero actor rows, zero reports
        expect(await ratelimitLib.getRemainingCommentCooldownSeconds(actor.actorId)).toBe(0);
        expect(state.dailyQuotas).toHaveLength(0);
        expect(state.actors).toHaveLength(0);
        expect(state.reports).toHaveLength(0);

        const validComment = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
          {
            cookie: actor.cookieHeader,
            body: { type: 'info', body: 'Clean verified observation here.' },
          },
        );
        expect(validComment.status).toBe(201);

        // Full 20/day flag budget must remain completely untouched after invalid report notes
        for (let i = 0; i < RATE.FLAG_ACTIONS_PER_ACTOR_PER_DAY; i += 1) {
          const extraId = new Types.ObjectId();
          const extraTracking = `MD-F${String(i).padStart(7, '2')}`;
          state.incidents.push({
            _id: extraId,
            trackingId: extraTracking,
            status: 'published',
          });
          const flagRes = await apiJson(
            baseUrl,
            'POST',
            `/api/v1/incidents/${extraTracking}/reports`,
            {
              cookie: actor.cookieHeader,
              body: { reason: 'irrelevant', note: `Clean report note ${i}` },
            },
          );
          expect(flagRes.status).toBe(201);
        }
        expect(state.reports).toHaveLength(RATE.FLAG_ACTIONS_PER_ACTOR_PER_DAY);
      });
    });
  });

  describe('3. Quota, cooldown, self-delete window, freeze, vote & flag limits', () => {
    it('enforces 30s cooldown, 5/day comment quota, 15m delete window, freeze_comments, 30/hr votes & 20/day flags with Retry-After', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-11T09:00:00.000Z'));

      await withServer(async (baseUrl) => {
        const actor = makeActorCookie();

        // Comment #1
        const c1 = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
          {
            cookie: actor.cookieHeader,
            ip: '198.51.100.20',
            body: { type: 'info', body: 'First comment on scene.' },
          },
        );
        expect(c1.status).toBe(201);

        // Cooldown hit at +10s -> 429 RATE_LIMITED with Retry-After header
        vi.advanceTimersByTime(10_000);
        const cooldownHit = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
          {
            cookie: actor.cookieHeader,
            ip: '198.51.100.20',
            body: { type: 'info', body: 'Too early comment attempt.' },
          },
        );
        expect(cooldownHit.status).toBe(429);
        expect(cooldownHit.body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
        expect(Number(cooldownHit.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
        expect(
          state.abuseSignals.some(
            (s) => s.type === 'rate_limit_hit' && s.actorId === actor.actorId,
          ),
        ).toBe(true);

        // Remaining 4 comments spaced past cooldown reach 5/day limit
        for (let i = 2; i <= RATE.COMMENTS_PER_ACTOR_PER_DAY; i += 1) {
          vi.advanceTimersByTime(31_000);
          const res = await apiJson(
            baseUrl,
            'POST',
            `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
            {
              cookie: actor.cookieHeader,
              ip: '198.51.100.20',
              body: { type: 'info', body: `Sequential valid comment number ${i}.` },
            },
          );
          expect(res.status).toBe(201);
          expect(res.body.quota.commentsLeft).toBe(RATE.COMMENTS_PER_ACTOR_PER_DAY - i);
        }

        // 6th comment after cooldown -> 429 QUOTA_EXCEEDED with resetsAt
        vi.advanceTimersByTime(31_000);
        const c6 = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
          {
            cookie: actor.cookieHeader,
            ip: '198.51.100.20',
            body: { type: 'info', body: 'Sixth comment exceeding quota.' },
          },
        );
        expect(c6.status).toBe(429);
        expect(c6.body.error.code).toBe(ERROR_CODES.QUOTA_EXCEEDED);
        expect(c6.body.error.details.resetsAt).toBe('2026-11-11T18:00:00.000Z');

        // 15-minute comment deletion window boundary: c1 expired after +15m + 1ms
        vi.setSystemTime(
          new Date(
            new Date(c1.body.comment.createdAt as string).getTime() +
              EDIT.COMMENT_SELF_DELETE_MINUTES * 60 * 1000 +
              1,
          ),
        );
        const lateDelete = await apiJson(
          baseUrl,
          'DELETE',
          `/api/v1/comments/${c1.body.comment.id}`,
          { cookie: actor.cookieHeader },
        );
        expect(lateDelete.status).toBe(403);
        expect(lateDelete.body.error.code).toBe(ERROR_CODES.EDIT_WINDOW_CLOSED);

        // Platform freeze_comments -> 403 FORBIDDEN
        const freshActor = makeActorCookie();
        state.settings = [
          { key: SETTING_KEYS.FREEZE_POSTING, value: false },
          { key: SETTING_KEYS.FREEZE_COMMENTS, value: true },
        ];
        const frozenRes = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
          {
            cookie: freshActor.cookieHeader,
            body: { type: 'info', body: 'Comment while platform frozen.' },
          },
        );
        expect(frozenRes.status).toBe(403);
        expect(frozenRes.body.error.code).toBe(ERROR_CODES.FORBIDDEN);

        // 30 votes/hour sliding window -> 31st gets 429 RATE_LIMITED + Retry-After
        const voter = makeActorCookie();
        for (let i = 0; i < RATE.VOTE_ACTIONS_PER_ACTOR_PER_HOUR; i += 1) {
          const res = await apiJson(
            baseUrl,
            'POST',
            `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/vote`,
            {
              cookie: voter.cookieHeader,
              ip: '198.51.100.30',
              body: { type: i % 2 === 0 ? 'support' : 'dispute' },
            },
          );
          expect(res.status).toBe(200);
        }
        const vote31 = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/vote`,
          {
            cookie: voter.cookieHeader,
            ip: '198.51.100.30',
            body: { type: 'support' },
          },
        );
        expect(vote31.status).toBe(429);
        expect(vote31.body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
        expect(Number(vote31.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);

        // 20 flags/24h sliding window -> 21st gets 429 RATE_LIMITED + Retry-After
        const flagger = makeActorCookie();
        for (let i = 0; i < RATE.FLAG_ACTIONS_PER_ACTOR_PER_DAY; i += 1) {
          const targetId = new Types.ObjectId();
          const tracking = `MD-R${String(i).padStart(7, '2')}`;
          state.incidents.push({ _id: targetId, trackingId: tracking, status: 'published' });
          const repRes = await apiJson(
            baseUrl,
            'POST',
            `/api/v1/incidents/${tracking}/reports`,
            {
              cookie: flagger.cookieHeader,
              ip: '198.51.100.31',
              body: { reason: 'misleading' },
            },
          );
          expect(repRes.status).toBe(201);
        }
        const flag21 = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/reports`,
          {
            cookie: flagger.cookieHeader,
            ip: '198.51.100.31',
            body: { reason: 'spam' },
          },
        );
        expect(flag21.status).toBe(429);
        expect(flag21.body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
        expect(Number(flag21.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('4. IP soft cap (30/day) & unmet CAPTCHA protection (BUG-3B-1)', () => {
    it('allows 30 comments/day per IP without CAPTCHA, requires CAPTCHA on 31st without consuming cooldown/IP hits/quota on 428', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-11T11:00:00.000Z'));

      await withServer(async (baseUrl) => {
        const sharedIp = '198.51.100.55';
        const verifierCalls: string[] = [];
        setTurnstileVerifierForTests(async ({ token }) => {
          verifierCalls.push(token);
          return token === 'valid-turnstile-token';
        });

        // Distinct actors post 30 comments from shared IP without captchaToken
        for (let i = 1; i <= RATE.COMMENTS_PER_IP_PER_DAY_SOFT; i += 1) {
          const a = makeActorCookie();
          const res = await apiJson(
            baseUrl,
            'POST',
            `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
            {
              cookie: a.cookieHeader,
              ip: sharedIp,
              body: { type: 'info', body: `Shared IP comment number ${i}` },
            },
          );
          expect(res.status).toBe(201);
        }

        const actor31 = makeActorCookie();

        // Missing captchaToken -> 428 CAPTCHA_REQUIRED, zero quota/cooldown loss
        const missingCaptcha = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
          {
            cookie: actor31.cookieHeader,
            ip: sharedIp,
            body: { type: 'info', body: 'Comment 31 missing captcha token.' },
          },
        );
        expect(missingCaptcha.status).toBe(428);
        expect(missingCaptcha.body.error.code).toBe(ERROR_CODES.CAPTCHA_REQUIRED);
        expect(await ratelimitLib.getRemainingCommentCooldownSeconds(actor31.actorId)).toBe(0);
        expect(state.dailyQuotas.some((q) => q.actorId === actor31.actorId)).toBe(false);

        // Invalid captchaToken -> 428 CAPTCHA_REQUIRED + records captcha_failed, zero cooldown/quota loss
        const wrongCaptcha = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
          {
            cookie: actor31.cookieHeader,
            ip: sharedIp,
            body: {
              type: 'info',
              body: 'Comment 31 with wrong captcha token.',
              captchaToken: 'bad-token',
            },
          },
        );
        expect(wrongCaptcha.status).toBe(428);
        expect(await ratelimitLib.getRemainingCommentCooldownSeconds(actor31.actorId)).toBe(0);
        expect(state.dailyQuotas.some((q) => q.actorId === actor31.actorId)).toBe(false);
        expect(
          state.abuseSignals.some(
            (s) => s.type === 'captcha_failed' && s.actorId === actor31.actorId,
          ),
        ).toBe(true);

        // Immediate retry 1s later WITH valid captchaToken succeeds 201 (verified only once)
        vi.advanceTimersByTime(1_000);
        verifierCalls.length = 0;
        const retrySuccess = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
          {
            cookie: actor31.cookieHeader,
            ip: sharedIp,
            body: {
              type: 'info',
              body: 'Comment 31 retrying immediately with valid token.',
              captchaToken: 'valid-turnstile-token',
            },
          },
        );
        expect(retrySuccess.status).toBe(201);
        expect(verifierCalls).toEqual(['valid-turnstile-token']);
        expect(retrySuccess.body.quota.commentsLeft).toBe(
          RATE.COMMENTS_PER_ACTOR_PER_DAY - 1,
        );
        expect(
          state.abuseSignals.some(
            (s) => s.type === 'comment_ip_soft_cap' && s.actorId === actor31.actorId,
          ),
        ).toBe(true);
      });
    });
  });

  describe('5. Ownership & actor restriction scope enforcement (BUG-3B-3)', () => {
    it('enforces comment delete ownership and isolates comment/vote restrictions cleanly without burning limits', async () => {
      await withServer(async (baseUrl) => {
        const owner = makeActorCookie();
        const stranger = makeActorCookie();
        const commentRestricted = makeActorCookie();
        const voteRestricted = makeActorCookie();
        const postOnlyRestricted = makeActorCookie();

        const commentId = new Types.ObjectId();
        state.comments.push({
          _id: commentId,
          incidentId: publishedIncidentId,
          actorId: owner.actorId,
          type: 'info',
          body: 'Owner comment protected from stranger delete.',
          status: 'published',
          redacted: false,
          createdAt: new Date(),
        });

        const futureUntil = new Date(Date.now() + 2 * 60 * 60 * 1000);
        state.actors.push(
          {
            _id: new Types.ObjectId(),
            actorId: commentRestricted.actorId,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            restriction: { scope: ['comment'], until: futureUntil, reason: 'Abuse' },
          },
          {
            _id: new Types.ObjectId(),
            actorId: voteRestricted.actorId,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            restriction: { scope: ['vote'], until: futureUntil, reason: 'Brigading' },
          },
          {
            _id: new Types.ObjectId(),
            actorId: postOnlyRestricted.actorId,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            restriction: { scope: ['post'], until: futureUntil, reason: 'Post spam' },
          },
        );

        const strangerDelete = await apiJson(
          baseUrl,
          'DELETE',
          `/api/v1/comments/${commentId.toString()}`,
          { cookie: stranger.cookieHeader },
        );
        expect(strangerDelete.status).toBe(403);
        expect(strangerDelete.body.error.code).toBe(ERROR_CODES.FORBIDDEN);

        const restrictedCommentRes = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
          {
            cookie: commentRestricted.cookieHeader,
            body: { type: 'info', body: 'Comment from restricted actor.' },
          },
        );
        expect(restrictedCommentRes.status).toBe(403);
        expect(
          await ratelimitLib.getRemainingCommentCooldownSeconds(commentRestricted.actorId),
        ).toBe(0);
        expect(
          state.dailyQuotas.some((q) => q.actorId === commentRestricted.actorId),
        ).toBe(false);

        // Vote-restricted actor blocked on BOTH POST /vote AND DELETE /vote (BUG-3B-3)
        state.votes.push({
          _id: new Types.ObjectId(),
          incidentId: publishedIncidentId,
          actorId: voteRestricted.actorId,
          type: 'support',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const consumeVoteSpy = vi.spyOn(ratelimitLib, 'consumeVoteActionLimit');

        const blockedPostVote = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/vote`,
          { cookie: voteRestricted.cookieHeader, body: { type: 'dispute' } },
        );
        expect(blockedPostVote.status).toBe(403);

        const blockedDelVote = await apiJson(
          baseUrl,
          'DELETE',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/vote`,
          { cookie: voteRestricted.cookieHeader },
        );
        expect(blockedDelVote.status).toBe(403);
        expect(consumeVoteSpy).not.toHaveBeenCalled();
        expect(state.votes).toHaveLength(1);

        // Restriction on ['post'] only MUST NOT block comments or votes
        const postRestrictedComment = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
          {
            cookie: postOnlyRestricted.cookieHeader,
            body: { type: 'info', body: 'Post-restricted actor can still comment.' },
          },
        );
        expect(postRestrictedComment.status).toBe(201);

        const postRestrictedVote = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/vote`,
          { cookie: postOnlyRestricted.cookieHeader, body: { type: 'support' } },
        );
        expect(postRestrictedVote.status).toBe(200);
      });
    });
  });

  describe('6. Duplicate actions (idempotent votes & 409 duplicate flags)', () => {
    it('keeps duplicate vote idempotent at count 1 and returns 409 DUPLICATE_ACTION on repeated incident/comment flags', async () => {
      await withServer(async (baseUrl) => {
        const actor = makeActorCookie();
        const commentId = new Types.ObjectId();
        state.comments.push({
          _id: commentId,
          incidentId: publishedIncidentId,
          actorId: makeActorCookie().actorId,
          type: 'info',
          body: 'Target comment for duplicate flag test.',
          status: 'published',
          redacted: false,
          createdAt: new Date(),
        });

        const firstVote = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/vote`,
          { cookie: actor.cookieHeader, body: { type: 'support' } },
        );
        expect(firstVote.status).toBe(200);
        expect(firstVote.body).toEqual({
          counts: { support: 1, dispute: 0 },
          my: { vote: 'support' },
        });

        const repeatVote = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/vote`,
          { cookie: actor.cookieHeader, body: { type: 'support' } },
        );
        expect(repeatVote.status).toBe(200);
        expect(repeatVote.body).toEqual({
          counts: { support: 1, dispute: 0 },
          my: { vote: 'support' },
        });

        const firstIncFlag = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/reports`,
          { cookie: actor.cookieHeader, body: { reason: 'fake' } },
        );
        expect(firstIncFlag.status).toBe(201);

        const dupIncFlag = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/reports`,
          { cookie: actor.cookieHeader, body: { reason: 'spam' } },
        );
        expect(dupIncFlag.status).toBe(409);
        expect(dupIncFlag.body.error.code).toBe(ERROR_CODES.DUPLICATE_ACTION);
        expect(state.reports.filter((r) => r.targetType === 'incident')).toHaveLength(1);

        const firstComFlag = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/comments/${commentId.toString()}/reports`,
          { cookie: actor.cookieHeader, body: { reason: 'inappropriate' } },
        );
        expect(firstComFlag.status).toBe(201);

        const dupComFlag = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/comments/${commentId.toString()}/reports`,
          { cookie: actor.cookieHeader, body: { reason: 'spam' } },
        );
        expect(dupComFlag.status).toBe(409);
        expect(dupComFlag.body.error.code).toBe(ERROR_CODES.DUPLICATE_ACTION);
        expect(state.reports.filter((r) => r.targetType === 'comment')).toHaveLength(1);
      });
    });
  });

  describe('7. Concurrent requests (Promise.all)', () => {
    it('prevents double quota burn and double comments on simultaneous same-actor submissions', async () => {
      await withServer(async (baseUrl) => {
        const actor = makeActorCookie();
        const responses = await Promise.all(
          Array.from({ length: 5 }, (_, idx) =>
            apiJson(
              baseUrl,
              'POST',
              `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
              {
                cookie: actor.cookieHeader,
                body: { type: 'info', body: `Concurrent burst comment payload ${idx}` },
              },
            ),
          ),
        );

        expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
        expect(responses.filter((r) => r.status === 429)).toHaveLength(4);
        expect(state.comments).toHaveLength(1);
        expect(state.dailyQuotas[0]?.count).toBe(1);
      });
    });

    it('enforces atomic count < 5 on DailyQuota when simultaneous 5th & 6th calls race past cooldown (AC-07)', async () => {
      const actor = makeActorCookie();
      const ipHash = computeIpHash('203.0.113.88', process.env.IP_HMAC_SECRET as string);
      const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Dhaka',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());

      state.dailyQuotas.push({
        _id: new Types.ObjectId(),
        actorId: actor.actorId,
        day,
        kind: 'comment',
        count: 4,
        expiresAt: new Date(Date.now() + 86_400_000),
      });

      vi.spyOn(ratelimitLib, 'getRemainingCommentCooldownSeconds').mockResolvedValue(0);
      vi.spyOn(ratelimitLib, 'acquireCommentCooldown').mockResolvedValue({ allowed: true });

      const settled = await Promise.allSettled([
        createComment(
          PUBLISHED_TRACKING_ID,
          { type: 'info', body: 'Concurrent 5th candidate A' },
          { actorId: actor.actorId, ipHash },
        ),
        createComment(
          PUBLISHED_TRACKING_ID,
          { type: 'info', body: 'Concurrent 5th candidate B' },
          { actorId: actor.actorId, ipHash },
        ),
      ]);

      const fulfilled = settled.filter((r) => r.status === 'fulfilled');
      const rejected = settled.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      if (rejected[0]?.status === 'rejected') {
        expect(rejected[0].reason).toMatchObject({
          statusCode: 429,
          code: ERROR_CODES.QUOTA_EXCEEDED,
        });
      }
      expect(state.dailyQuotas[0]?.count).toBe(5);
      expect(state.comments).toHaveLength(1);
    });

    it('handles concurrent IP 30->31 soft-cap crossing without stranding the rejected actor cooldown lock', async () => {
      await withServer(async (baseUrl) => {
        const sharedIp = '198.51.100.99';
        const now = new Date();
        const sharedIpHash = computeIpHash(
          sharedIp,
          process.env.IP_HMAC_SECRET as string,
          now,
        );
        for (let i = 0; i < RATE.COMMENTS_PER_IP_PER_DAY_SOFT - 1; i += 1) {
          await ratelimitLib.recordCommentIpHit(sharedIpHash, now);
        }

        const actorA = makeActorCookie();
        const actorB = makeActorCookie();

        const [resA, resB] = await Promise.all([
          apiJson(
            baseUrl,
            'POST',
            `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
            {
              cookie: actorA.cookieHeader,
              ip: sharedIp,
              body: { type: 'info', body: 'Concurrent boundary actor A.' },
            },
          ),
          apiJson(
            baseUrl,
            'POST',
            `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
            {
              cookie: actorB.cookieHeader,
              ip: sharedIp,
              body: { type: 'info', body: 'Concurrent boundary actor B.' },
            },
          ),
        ]);

        const pair = [
          { res: resA, actor: actorA },
          { res: resB, actor: actorB },
        ];
        const passed = pair.filter((entry) => entry.res.status === 201);
        const challenged = pair.filter((entry) => entry.res.status === 428);

        expect(passed).toHaveLength(1);
        expect(challenged).toHaveLength(1);

        const loser = challenged[0]!.actor;
        expect(await ratelimitLib.getRemainingCommentCooldownSeconds(loser.actorId)).toBe(0);

        const retryRes = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
          {
            cookie: loser.cookieHeader,
            ip: sharedIp,
            body: {
              type: 'info',
              body: 'Boundary loser immediate retry with valid CAPTCHA.',
              captchaToken: 'valid-turnstile-token',
            },
          },
        );
        expect(retryRes.status).toBe(201);
      });
    });

    it('permits only one success on concurrent owner DELETE, resolves concurrent initial vote E11000 cleanly, and deduplicates concurrent flags', async () => {
      await withServer(async (baseUrl) => {
        const owner = makeActorCookie();
        const commentId = new Types.ObjectId();
        state.comments.push({
          _id: commentId,
          incidentId: publishedIncidentId,
          actorId: owner.actorId,
          type: 'info',
          body: 'Comment targeted by concurrent deletes.',
          status: 'published',
          redacted: false,
          createdAt: new Date(),
        });

        const deleteResponses = await Promise.all([
          apiJson(baseUrl, 'DELETE', `/api/v1/comments/${commentId.toString()}`, {
            cookie: owner.cookieHeader,
          }),
          apiJson(baseUrl, 'DELETE', `/api/v1/comments/${commentId.toString()}`, {
            cookie: owner.cookieHeader,
          }),
        ]);
        expect(deleteResponses.filter((r) => r.status === 200)).toHaveLength(1);
        expect(deleteResponses.filter((r) => r.status === 404)).toHaveLength(1);

        // Concurrent initial vote E11000 recovery keeps count at 1
        const voter = makeActorCookie();
        state.failNextVoteUpsertWithE11000 = true;
        const voteResponses = await Promise.all([
          apiJson(baseUrl, 'POST', `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/vote`, {
            cookie: voter.cookieHeader,
            body: { type: 'support' },
          }),
          apiJson(baseUrl, 'POST', `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/vote`, {
            cookie: voter.cookieHeader,
            body: { type: 'support' },
          }),
        ]);
        expect(voteResponses.every((r) => r.status === 200)).toBe(true);
        expect(state.votes).toHaveLength(1);
        expect(voteResponses[1]?.body).toEqual({
          counts: { support: 1, dispute: 0 },
          my: { vote: 'support' },
        });

        // Concurrent duplicate flags against the same target -> strictly 1 created, rest 409 DUPLICATE_ACTION
        const flagger = makeActorCookie();
        const flagResponses = await Promise.all(
          Array.from({ length: 4 }, () =>
            apiJson(baseUrl, 'POST', `/api/v1/incidents/${SECOND_TRACKING_ID}/reports`, {
              cookie: flagger.cookieHeader,
              body: { reason: 'spam' },
            }),
          ),
        );
        expect(flagResponses.filter((r) => r.status === 201)).toHaveLength(1);
        expect(flagResponses.filter((r) => r.status === 409)).toHaveLength(3);
        expect(state.reports).toHaveLength(1);
      });
    });
  });

  describe('8. Asia/Dhaka day-boundary quota rollover', () => {
    it('resets 5/day comment quota at 00:00 Asia/Dhaka (18:00 UTC) and stores new day key cleanly', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-11T17:55:00.000Z')); // 23:55:00 Nov 11 Asia/Dhaka

      await withServer(async (baseUrl) => {
        const actor = makeActorCookie();

        for (let i = 1; i <= RATE.COMMENTS_PER_ACTOR_PER_DAY; i += 1) {
          const res = await apiJson(
            baseUrl,
            'POST',
            `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
            {
              cookie: actor.cookieHeader,
              body: { type: 'info', body: `Pre-midnight comment #${i}` },
            },
          );
          expect(res.status).toBe(201);
          vi.advanceTimersByTime(31_000);
        }

        // Still Nov 11 in Asia/Dhaka (23:57:35)
        const beforeRolloverQuota = await apiJson(baseUrl, 'GET', '/api/v1/me/quota', {
          cookie: actor.cookieHeader,
        });
        expect(beforeRolloverQuota.status).toBe(200);
        expect(beforeRolloverQuota.body).toEqual({
          commentsLeft: 0,
          limit: RATE.COMMENTS_PER_ACTOR_PER_DAY,
          resetsAt: '2026-11-11T18:00:00.000Z',
        });
        expect(state.dailyQuotas[0]?.day).toBe('2026-11-11');

        // Advance past 18:00:00Z (00:00:05 Nov 12 Asia/Dhaka)
        vi.setSystemTime(new Date('2026-11-11T18:00:05.000Z'));

        const afterRolloverQuota = await apiJson(baseUrl, 'GET', '/api/v1/me/quota', {
          cookie: actor.cookieHeader,
        });
        expect(afterRolloverQuota.status).toBe(200);
        expect(afterRolloverQuota.body).toEqual({
          commentsLeft: RATE.COMMENTS_PER_ACTOR_PER_DAY,
          limit: RATE.COMMENTS_PER_ACTOR_PER_DAY,
          resetsAt: '2026-11-12T18:00:00.000Z',
        });

        const postMidnightRes = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
          {
            cookie: actor.cookieHeader,
            body: { type: 'info', body: 'Fresh Asia/Dhaka day comment succeeds!' },
          },
        );
        expect(postMidnightRes.status).toBe(201);
        expect(postMidnightRes.body.quota).toEqual({
          commentsLeft: RATE.COMMENTS_PER_ACTOR_PER_DAY - 1,
          resetsAt: '2026-11-12T18:00:00.000Z',
        });
        expect(state.dailyQuotas.map((q) => q.day)).toEqual(['2026-11-11', '2026-11-12']);
      });
    });
  });

  describe('9. Privacy & HMAC fail-closed checks', () => {
    it('stores daily-salted HMAC ipHash in AbuseSignals without exposing raw IP, actorId, or secrets publicly, and fails closed if IP_HMAC_SECRET is unset', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-11T12:00:00.000Z'));

      await withServer(async (baseUrl) => {
        const rawIp = '198.51.100.77';
        const actor = makeActorCookie();

        await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
          {
            cookie: actor.cookieHeader,
            ip: rawIp,
            body: { type: 'info', body: 'Initial valid comment for signal check.' },
          },
        );

        const rateHitRes = await apiJson(
          baseUrl,
          'POST',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
          {
            cookie: actor.cookieHeader,
            ip: rawIp,
            body: {
              type: 'info',
              body: 'Immediate second comment triggers rate_limit_hit.',
            },
          },
        );
        expect(rateHitRes.status).toBe(429);

        expect(state.abuseSignals).toHaveLength(1);
        const signal = state.abuseSignals[0]!;
        expect(signal.ipHash).toMatch(PATTERNS.IP_HASH_HEX);
        expect(signal.ipHash).toBe(
          computeIpHash(rawIp, process.env.IP_HMAC_SECRET as string, new Date()),
        );
        expect(JSON.stringify(state.abuseSignals)).not.toContain(rawIp);

        const listRes = await apiJson(
          baseUrl,
          'GET',
          `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/comments`,
          { cookie: actor.cookieHeader },
        );
        expect(listRes.status).toBe(200);
        const serialized = JSON.stringify(listRes.body);
        expect(serialized).not.toContain(actor.actorId);
        expect(serialized).not.toContain(signal.ipHash);
        expect(serialized).not.toContain('secretHash');

        const originalIpSecret = process.env.IP_HMAC_SECRET;
        delete process.env.IP_HMAC_SECRET;
        try {
          const failClosedRes = await apiJson(
            baseUrl,
            'POST',
            `/api/v1/incidents/${PUBLISHED_TRACKING_ID}/vote`,
            {
              cookie: actor.cookieHeader,
              ip: rawIp,
              body: { type: 'support' },
            },
          );
          expect(failClosedRes.status).toBe(500);
          expect(failClosedRes.body.error.code).toBe(ERROR_CODES.INTERNAL);
        } finally {
          process.env.IP_HMAC_SECRET = originalIpSecret;
        }
      });
    });
  });
});
