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
  process.env.DB_NAME = 'mamladibe_phase3c_test';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/mamladibe_phase3c_test';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
  process.env.LOG_LEVEL = 'silent';
  process.env.ACTOR_HMAC_SECRET = 'phase3c-test-actor-secret-32chars-min';
  process.env.IP_HMAC_SECRET = 'phase3c-test-ip-hmac-secret-32chars-m';
  process.env.SESSION_SECRET = 'phase3c-test-session-secret-32chars';
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
  PAGING,
  RATE,
  SETTING_KEYS,
} from '../../src/constants/index.js';
import { setTurnstileVerifierForTests } from '../../src/lib/captcha.js';
import { computeActorId, generateBrowserToken, sha256Hex } from '../../src/lib/crypto.js';
import {
  InMemoryRateLimitStore,
  setRateLimitStoreForTests,
} from '../../src/lib/ratelimit.js';
import { computeIncidentContentHash } from '../../src/lib/text-rules.js';
import { hashReporterSecret } from '../../src/lib/tracking.js';
import {
  AbuseSignalModel,
  ActorModel,
  CommentModel,
  IncidentModel,
  IncidentVersionModel,
  ReportModel,
  SettingModel,
  VoteModel,
} from '../../src/models/index.js';
import type {
  AbuseSignalType,
  CommentStatus,
  IncidentCategory,
  IncidentSource,
  IncidentStatus,
  ModerationOutcome,
  VoteType,
} from '../../src/types/index.js';

const TEST_ORIGIN = 'http://localhost:5173';

interface IncidentDoc {
  _id: Types.ObjectId;
  trackingId: string;
  secretHash: string;
  title: string;
  description: string;
  category: IncidentCategory;
  incidentAt: Date;
  location: { type: 'Point'; coordinates: [number, number] };
  roadName?: string;
  areaName?: string;
  upazila?: string;
  district?: string;
  safetyTip?: string;
  status: IncidentStatus;
  moderationOutcome?: ModerationOutcome;
  isEdited: boolean;
  editedAt?: Date;
  editCount: number;
  moderatedEdit: boolean;
  source: IncidentSource;
  actorId: string;
  contentHash: string;
  hiddenAt?: Date;
  deletedAt?: Date;
  purgeAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface IncidentVersionDoc {
  _id: Types.ObjectId;
  incidentId: Types.ObjectId;
  version: number;
  title: string;
  description: string;
  safetyTip?: string;
  editedAt: Date;
  editedBy: 'reporter' | 'moderator';
  reason?: string;
}

interface CommentDoc {
  _id: Types.ObjectId;
  incidentId: Types.ObjectId;
  status: CommentStatus;
}

interface VoteDoc {
  _id: Types.ObjectId;
  incidentId: Types.ObjectId;
  actorId: string;
  type: VoteType;
}

interface ReportDoc {
  _id: Types.ObjectId;
  targetType: 'incident' | 'comment';
  targetId: Types.ObjectId;
  actorId: string;
}

interface AbuseSignalDoc {
  _id: Types.ObjectId;
  ipHash: string;
  actorId?: string;
  type: AbuseSignalType;
  createdAt: Date;
}

interface HarnessState {
  incidents: IncidentDoc[];
  versions: IncidentVersionDoc[];
  comments: CommentDoc[];
  votes: VoteDoc[];
  reports: ReportDoc[];
  abuseSignals: AbuseSignalDoc[];
  afterFindOne?: () => Promise<void> | void;
  beforeFindOneAndUpdate?: (filter: Record<string, unknown>) => void;
}

function sphereDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6378.1 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function matchesCondition(doc: IncidentDoc, cond: Record<string, unknown>): boolean {
  for (const [key, val] of Object.entries(cond)) {
    if (key === '$and' && Array.isArray(val)) {
      if (!val.every((sub) => matchesCondition(doc, sub as Record<string, unknown>))) {
        return false;
      }
      continue;
    }

    if (key === '$or' && Array.isArray(val)) {
      if (!val.some((sub) => matchesCondition(doc, sub as Record<string, unknown>))) {
        return false;
      }
      continue;
    }

    if (key === '$text' && val && typeof val === 'object') {
      const search = String((val as { $search: string }).$search ?? '')
        .toLowerCase()
        .trim();
      if (!search) continue;
      const haystack = [
        doc.title,
        doc.description,
        doc.roadName ?? '',
        doc.areaName ?? '',
        doc.district ?? '',
      ]
        .join(' ')
        .toLowerCase();
      const tokens = search.split(/\s+/).filter(Boolean);
      if (!tokens.some((tok) => haystack.includes(tok))) {
        return false;
      }
      continue;
    }

    if (key === 'location' && val && typeof val === 'object') {
      const geoWithin = (val as { $geoWithin?: Record<string, unknown> }).$geoWithin;
      if (geoWithin?.$box) {
        const [[west, south], [east, north]] = geoWithin.$box as [
          [number, number],
          [number, number],
        ];
        const [lng, lat] = doc.location.coordinates;
        if (lng < west || lng > east || lat < south || lat > north) {
          return false;
        }
      }
      if (geoWithin?.$centerSphere) {
        const [[centerLng, centerLat], radians] = geoWithin.$centerSphere as [
          [number, number],
          number,
        ];
        const radiusKm = radians * 6378.1;
        const [docLng, docLat] = doc.location.coordinates;
        if (sphereDistanceKm(centerLat, centerLng, docLat, docLng) > radiusKm) {
          return false;
        }
      }
      continue;
    }

    if (key === 'createdAt' && val && typeof val === 'object' && !(val instanceof Date)) {
      const range = val as {
        $gte?: Date;
        $lte?: Date;
        $lt?: Date;
        $gt?: Date;
      };
      const time = doc.createdAt.getTime();
      if (range.$gte && time < range.$gte.getTime()) return false;
      if (range.$lte && time > range.$lte.getTime()) return false;
      if (range.$lt && time >= range.$lt.getTime()) return false;
      if (range.$gt && time <= range.$gt.getTime()) return false;
      continue;
    }

    if (key === '_id' && val && typeof val === 'object' && !(val instanceof Types.ObjectId)) {
      const range = val as { $lt?: Types.ObjectId; $gt?: Types.ObjectId };
      const cmp = doc._id.toString().localeCompare((range.$lt ?? range.$gt ?? '').toString());
      if (range.$lt && !(cmp < 0)) return false;
      if (range.$gt && !(cmp > 0)) return false;
      continue;
    }

    if (key === 'category' && val && typeof val === 'object') {
      const inList = (val as { $in?: string[] }).$in;
      if (Array.isArray(inList) && !inList.includes(doc.category)) {
        return false;
      }
      continue;
    }

    if (key === 'district' && val && typeof val === 'object') {
      const rx = val as { $regex: string; $options?: string };
      const re = new RegExp(rx.$regex, rx.$options ?? '');
      if (!doc.district || !re.test(doc.district)) {
        return false;
      }
      continue;
    }

    if (key === '_id') {
      if (doc._id.toString() !== String(val)) return false;
      continue;
    }

    const docVal = (doc as unknown as Record<string, unknown>)[key];
    if (val && typeof val === 'object' && !(val instanceof Date)) {
      const ops = val as { $ne?: unknown; $in?: unknown[] };
      if ('$ne' in ops && docVal === ops.$ne) return false;
      if (Array.isArray(ops.$in) && !ops.$in.includes(docVal)) return false;
      continue;
    }
    if (val instanceof Date) {
      if (!(docVal instanceof Date) || docVal.getTime() !== val.getTime()) return false;
    } else if (docVal !== val) {
      return false;
    }
  }

  return true;
}

function projectIncident(
  doc: IncidentDoc,
  selectArg: string | undefined,
): Record<string, unknown> {
  const clone = { ...doc } as unknown as Record<string, unknown>;
  if (!selectArg) {
    delete clone.secretHash;
    return clone;
  }

  const tokens = selectArg.trim().split(/\s+/).filter(Boolean);
  if (tokens.includes('+secretHash')) {
    return clone;
  }

  if (tokens.some((tok) => tok.startsWith('-'))) {
    delete clone.secretHash;
    for (const tok of tokens) {
      if (tok.startsWith('-')) {
        delete clone[tok.slice(1)];
      }
    }
    return clone;
  }

  const out: Record<string, unknown> = { _id: doc._id };
  for (const field of tokens) {
    if (clone[field] !== undefined) {
      out[field] = clone[field];
    }
  }
  return out;
}

function installStatefulMongoMocks(state: HarnessState): void {
  vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);

  vi.spyOn(SettingModel, 'find').mockImplementation((() => ({
    select: () => ({
      lean: async () => [
        { key: SETTING_KEYS.FREEZE_POSTING, value: false },
        { key: SETTING_KEYS.FREEZE_COMMENTS, value: false },
      ],
    }),
  })) as never);

  vi.spyOn(SettingModel, 'findOne').mockImplementation((({ key }: { key: string }) => ({
    select: () => ({
      lean: async () => (key === SETTING_KEYS.FREEZE_POSTING ? { key, value: false } : null),
    }),
  })) as never);

  vi.spyOn(ActorModel, 'findOneAndUpdate').mockImplementation((({
    actorId,
  }: {
    actorId: string;
  }) => ({
    lean: async () => ({
      _id: new Types.ObjectId(),
      actorId,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    }),
  })) as never);

  vi.spyOn(IncidentModel, 'find').mockImplementation(((filter: Record<string, unknown>) => {
    let selectSpec: string | undefined;
    let sortSpec: Record<string, 1 | -1> | undefined;
    let limitNum: number | undefined;

    const query = {
      select(spec: string) {
        selectSpec = spec;
        return query;
      },
      sort(spec: Record<string, 1 | -1>) {
        sortSpec = spec;
        return query;
      },
      limit(n: number) {
        limitNum = n;
        return query;
      },
      async lean() {
        let rows = state.incidents.filter((doc) => matchesCondition(doc, filter));
        if (sortSpec) {
          rows = [...rows].sort((a, b) => {
            if (sortSpec!.createdAt) {
              const diff =
                (a.createdAt.getTime() - b.createdAt.getTime()) * sortSpec!.createdAt;
              if (diff !== 0) return diff;
            }
            if (sortSpec!._id) {
              return a._id.toString().localeCompare(b._id.toString()) * sortSpec!._id;
            }
            return 0;
          });
        }
        if (typeof limitNum === 'number') {
          rows = rows.slice(0, limitNum);
        }
        return rows.map((doc) => projectIncident(doc, selectSpec));
      },
    };
    return query;
  }) as never);

  vi.spyOn(IncidentModel, 'findOne').mockImplementation(((filter: Record<string, unknown>) => {
    let selectSpec: string | undefined;
    const query = {
      select(spec: string) {
        selectSpec = spec;
        return query;
      },
      async lean() {
        const found = state.incidents.find((doc) => matchesCondition(doc, filter));
        await state.afterFindOne?.();
        return found ? projectIncident(found, selectSpec) : null;
      },
    };
    return query;
  }) as never);

  vi.spyOn(IncidentModel, 'exists').mockImplementation((async (
    filter: Record<string, unknown>,
  ) => {
    const found = state.incidents.find((doc) => matchesCondition(doc, filter));
    return found ? { _id: found._id } : null;
  }) as never);

  vi.spyOn(IncidentModel, 'create').mockImplementation((async (doc: Partial<IncidentDoc>) => {
    if (state.incidents.some((i) => i.trackingId === doc.trackingId)) {
      throw Object.assign(new Error('Duplicate trackingId'), { code: 11000 });
    }
    const created: IncidentDoc = {
      _id: doc._id ?? new Types.ObjectId(),
      trackingId: doc.trackingId!,
      secretHash: doc.secretHash!,
      title: doc.title!,
      description: doc.description!,
      category: doc.category!,
      incidentAt: doc.incidentAt!,
      location: doc.location!,
      roadName: doc.roadName,
      areaName: doc.areaName,
      upazila: doc.upazila,
      district: doc.district,
      safetyTip: doc.safetyTip,
      status: doc.status ?? 'published',
      moderationOutcome: doc.moderationOutcome,
      isEdited: doc.isEdited ?? false,
      editedAt: doc.editedAt,
      editCount: doc.editCount ?? 0,
      moderatedEdit: doc.moderatedEdit ?? false,
      source: doc.source ?? 'public',
      actorId: doc.actorId!,
      contentHash: doc.contentHash!,
      createdAt: doc.createdAt ?? new Date(),
      updatedAt: doc.updatedAt ?? new Date(),
    };
    state.incidents.push(created);
    return {
      ...created,
      toObject: () => ({ ...created }),
    };
  }) as never);

  vi.spyOn(IncidentModel, 'findOneAndUpdate').mockImplementation(((
    filter: Record<string, unknown>,
    update: {
      $set?: Record<string, unknown>;
      $unset?: Record<string, unknown>;
      $inc?: Record<string, number>;
    },
  ) => {
    let selectSpec: string | undefined;
    const execute = async () => {
      state.beforeFindOneAndUpdate?.(filter);
      const doc = state.incidents.find((item) => matchesCondition(item, filter));
      if (!doc) return null;

      if (update.$set) {
        Object.assign(doc, update.$set);
      }
      if (update.$unset) {
        for (const key of Object.keys(update.$unset)) {
          delete (doc as unknown as Record<string, unknown>)[key];
        }
      }
      if (update.$inc) {
        for (const [key, delta] of Object.entries(update.$inc)) {
          const record = doc as unknown as Record<string, number>;
          record[key] = (record[key] ?? 0) + delta;
        }
      }
      doc.updatedAt = new Date();
      return projectIncident(doc, selectSpec);
    };

    const query = {
      select(spec: string) {
        selectSpec = spec;
        return query;
      },
      lean: execute,
    };
    return query;
  }) as never);

  vi.spyOn(IncidentVersionModel, 'create').mockImplementation((async (
    doc: Omit<IncidentVersionDoc, '_id'>,
  ) => {
    const duplicate = state.versions.some(
      (v) => v.incidentId.toString() === doc.incidentId.toString() && v.version === doc.version,
    );
    if (duplicate) {
      throw Object.assign(new Error('E11000 duplicate key on incident_versions'), {
        code: 11000,
      });
    }
    const created: IncidentVersionDoc = {
      _id: new Types.ObjectId(),
      ...doc,
    };
    state.versions.push(created);
    return created;
  }) as never);

  vi.spyOn(IncidentVersionModel, 'find').mockImplementation(((
    filter: { incidentId: Types.ObjectId },
  ) => {
    let sortDir: 1 | -1 = 1;
    const query = {
      sort(spec: { version?: 1 | -1 }) {
        sortDir = spec.version ?? 1;
        return query;
      },
      async lean() {
        return state.versions
          .filter((v) => v.incidentId.toString() === filter.incidentId.toString())
          .sort((a, b) => (a.version - b.version) * sortDir)
          .map((v) => ({ ...v }));
      },
    };
    return query;
  }) as never);

  vi.spyOn(IncidentVersionModel, 'deleteOne').mockImplementation((async (
    filter: { incidentId: Types.ObjectId; version: number; editedBy?: string },
  ) => {
    const idx = state.versions.findIndex(
      (v) =>
        v.incidentId.toString() === filter.incidentId.toString() &&
        v.version === filter.version &&
        (!filter.editedBy || v.editedBy === filter.editedBy),
    );
    if (idx === -1) return { deletedCount: 0 };
    state.versions.splice(idx, 1);
    return { deletedCount: 1 };
  }) as never);

  vi.spyOn(CommentModel, 'countDocuments').mockImplementation((async (filter: {
    incidentId: Types.ObjectId;
    status?: CommentStatus;
  }) => {
    return state.comments.filter(
      (c) =>
        c.incidentId.toString() === filter.incidentId.toString() &&
        (!filter.status || c.status === filter.status),
    ).length;
  }) as never);

  vi.spyOn(CommentModel, 'aggregate').mockImplementation((async (
    pipeline: Array<{ $match?: { incidentId?: { $in?: Types.ObjectId[] }; status?: CommentStatus } }>,
  ) => {
    const match = pipeline[0]?.$match;
    const ids = new Set((match?.incidentId?.$in ?? []).map((id) => id.toString()));
    const counts = new Map<string, { _id: Types.ObjectId; count: number }>();
    for (const c of state.comments) {
      const idStr = c.incidentId.toString();
      if (ids.size > 0 && !ids.has(idStr)) continue;
      if (match?.status && c.status !== match.status) continue;
      const existing = counts.get(idStr);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(idStr, { _id: c.incidentId, count: 1 });
      }
    }
    return Array.from(counts.values());
  }) as never);

  vi.spyOn(VoteModel, 'aggregate').mockImplementation((async (
    pipeline: Array<{ $match?: { incidentId?: Types.ObjectId } }>,
  ) => {
    const incidentId = pipeline[0]?.$match?.incidentId?.toString();
    let support = 0;
    let dispute = 0;
    for (const v of state.votes) {
      if (v.incidentId.toString() === incidentId) {
        if (v.type === 'support') support += 1;
        if (v.type === 'dispute') dispute += 1;
      }
    }
    const rows: Array<{ _id: VoteType; count: number }> = [];
    if (support > 0) rows.push({ _id: 'support', count: support });
    if (dispute > 0) rows.push({ _id: 'dispute', count: dispute });
    return rows;
  }) as never);

  vi.spyOn(VoteModel, 'findOne').mockImplementation((() => ({
    select: () => ({
      lean: async () => null,
    }),
  })) as never);

  vi.spyOn(ReportModel, 'countDocuments').mockImplementation((async (filter: {
    targetType: 'incident' | 'comment';
    targetId: Types.ObjectId;
  }) => {
    return state.reports.filter(
      (r) =>
        r.targetType === filter.targetType &&
        r.targetId.toString() === filter.targetId.toString(),
    ).length;
  }) as never);

  vi.spyOn(ReportModel, 'exists').mockImplementation((async () => null) as never);

  vi.spyOn(AbuseSignalModel, 'create').mockImplementation((async (
    doc: Omit<AbuseSignalDoc, '_id' | 'createdAt'>,
  ) => {
    const created: AbuseSignalDoc = {
      _id: new Types.ObjectId(),
      createdAt: new Date(),
      ...doc,
    };
    state.abuseSignals.push(created);
    return created;
  }) as never);
}

function seedIncident(
  state: HarnessState,
  overrides: Partial<IncidentDoc> & { rawSecret?: string } = {},
): { doc: IncidentDoc; rawSecret: string } {
  const rawSecret = overrides.rawSecret ?? '4F8QZ-N2M7C-KX9TA-W5H1R-D9P2E-Q';
  const title = overrides.title ?? 'Broken signal blocking evening traffic';
  const description =
    overrides.description ??
    'The main intersection signal has been off since evening causing heavy congestion.';
  const now = overrides.createdAt ?? new Date();
  const doc: IncidentDoc = {
    _id: overrides._id ?? new Types.ObjectId(),
    trackingId: overrides.trackingId ?? 'MD-7K3Q9XTB',
    secretHash: overrides.secretHash ?? hashReporterSecret(rawSecret),
    title,
    description,
    category: overrides.category ?? 'infrastructure',
    incidentAt: overrides.incidentAt ?? new Date(now.getTime() - 10 * 60 * 1000),
    location: overrides.location ?? { type: 'Point', coordinates: [90.41252, 23.81033] },
    roadName: 'roadName' in overrides ? overrides.roadName : 'Mirpur Road',
    areaName: 'areaName' in overrides ? overrides.areaName : 'Dhanmondi',
    upazila: 'upazila' in overrides ? overrides.upazila : 'Dhanmondi',
    district: 'district' in overrides ? overrides.district : 'Dhaka',
    safetyTip:
      'safetyTip' in overrides ? overrides.safetyTip : 'Use the service road until repaired.',
    status: overrides.status ?? 'published',
    moderationOutcome: overrides.moderationOutcome,
    isEdited: overrides.isEdited ?? false,
    editedAt: overrides.editedAt,
    editCount: overrides.editCount ?? 0,
    moderatedEdit: overrides.moderatedEdit ?? false,
    source: overrides.source ?? 'public',
    actorId: overrides.actorId ?? sha256Hex('actor-seed').slice(0, 32),
    contentHash:
      overrides.contentHash ?? computeIncidentContentHash({ title, description }),
    hiddenAt: overrides.hiddenAt,
    deletedAt: overrides.deletedAt,
    purgeAt: overrides.purgeAt,
    createdAt: now,
    updatedAt: overrides.updatedAt ?? now,
  };
  state.incidents.push(doc);
  return { doc, rawSecret };
}

async function httpJson(
  baseUrl: string,
  method: string,
  path: string,
  options: {
    body?: unknown;
    ip?: string;
    cookie?: string;
  } = {},
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      Origin: TEST_ORIGIN,
      'X-Forwarded-For': options.ip ?? '203.0.113.10',
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { res, status: res.status, json };
}

describe('Phase 3C HTTP integration: tracking, privacy, quick edit, feed pagination, nearest & map API', () => {
  let server: http.Server;
  let baseUrl = '';
  let state: HarnessState;

  beforeEach(async () => {
    void envSetup;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T10:00:00.000Z'));

    setRateLimitStoreForTests(new InMemoryRateLimitStore());
    setTurnstileVerifierForTests(async ({ token }) => token === 'valid-turnstile-token');

    state = {
      incidents: [],
      versions: [],
      comments: [],
      votes: [],
      reports: [],
      abuseSignals: [],
    };
    installStatefulMongoMocks(state);

    const app = createApp({ allowedOrigins: [TEST_ORIGIN] });
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setRateLimitStoreForTests(null);
    setTurnstileVerifierForTests(null);
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  afterAll(async () => {
    vi.useRealTimers();
  });

  describe('1. Tracking & Privacy', () => {
    it('tracks with Crockford typo normalization, returns Cache-Control: no-store, hides private fields & locks out after 5 wrong attempts across /track and PATCH', async () => {
      const canonicalSecret = '4F8QZ-N2M7C-KX9TA-W5H1R-D9P2E-Q';
      const { doc } = seedIncident(state, {
        trackingId: 'MD-7K3Q9XTB',
        rawSecret: canonicalSecret,
        createdAt: new Date('2026-11-11T09:55:00.000Z'),
      });
      state.comments.push(
        { _id: new Types.ObjectId(), incidentId: doc._id, status: 'published' },
        { _id: new Types.ObjectId(), incidentId: doc._id, status: 'hidden' },
      );
      state.votes.push({
        _id: new Types.ObjectId(),
        incidentId: doc._id,
        actorId: 'a'.repeat(32),
        type: 'support',
      });

      const typoSecret = canonicalSecret
        .toLowerCase()
        .replace(/1/g, 'l')
        .replace(/0/g, 'o')
        .replace(/-/g, ' ');

      const okRes = await httpJson(baseUrl, 'POST', '/api/v1/track', {
        body: { trackingId: 'md-7k3q9xtb', secret: typoSecret },
      });

      expect(okRes.status).toBe(200);
      expect(okRes.res.headers.get('cache-control')).toBe('no-store');
      expect(okRes.json).toMatchObject({
        status: 'published',
        outcome: null,
        incident: {
          trackingId: 'MD-7K3Q9XTB',
          title: doc.title,
          counts: { support: 1, dispute: 0, flags: 0, comments: 1 },
        },
        edit: { allowed: true, editsLeft: EDIT.MAX_EDITS },
      });

      const rawText = JSON.stringify(okRes.json);
      expect(rawText).not.toContain(doc.secretHash);
      expect(rawText).not.toContain(doc.actorId);
      expect(rawText).not.toContain(doc.contentHash);
      expect(rawText).not.toContain(doc._id.toString());

      // Wrong secret attempts: 3 via /track + 2 via PATCH => locks on 5th with 423 LOCKED
      for (let i = 0; i < 3; i += 1) {
        const fail = await httpJson(baseUrl, 'POST', '/api/v1/track', {
          ip: '198.51.100.77',
          body: { trackingId: 'MD-7K3Q9XTB', secret: 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-Z9P2E-Q' },
        });
        expect(fail.status).toBe(401);
        expect((fail.json.error as { code: string; message: string }).code).toBe(
          ERROR_CODES.UNAUTHORIZED,
        );
      }

      const fourthFail = await httpJson(baseUrl, 'PATCH', '/api/v1/incidents/MD-7K3Q9XTB', {
        ip: '198.51.100.77',
        body: { secret: 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-Z9P2E-Q', title: 'Updated valid title text' },
      });
      expect(fourthFail.status).toBe(401);

      const fifthFail = await httpJson(baseUrl, 'PATCH', '/api/v1/incidents/MD-7K3Q9XTB', {
        ip: '198.51.100.77',
        body: { secret: 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-Z9P2E-Q', title: 'Updated valid title text' },
      });
      expect(fifthFail.status).toBe(423);
      expect((fifthFail.json.error as { code: string }).code).toBe(ERROR_CODES.LOCKED);
      expect(
        (fifthFail.json.error as { details: { retryAfterSeconds: number } }).details
          .retryAfterSeconds,
      ).toBe(RATE.TRACK_LOCK_MINUTES * 60);

      // AbuseSignal recorded with hashed IP only
      expect(state.abuseSignals).toHaveLength(1);
      expect(state.abuseSignals[0]!.type).toBe('track_lockout');
      expect(state.abuseSignals[0]!.ipHash).toMatch(/^[0-9a-f]{32,64}$/);
      expect(state.abuseSignals[0]!.ipHash).not.toContain('198.51.100.77');

      // Correct secret stays locked within 15 minutes
      const blockedValid = await httpJson(baseUrl, 'POST', '/api/v1/track', {
        body: { trackingId: 'MD-7K3Q9XTB', secret: canonicalSecret },
      });
      expect(blockedValid.status).toBe(423);

      // Unlocks automatically after 15 minutes
      vi.advanceTimersByTime(RATE.TRACK_LOCK_MINUTES * 60 * 1000 + 1000);
      const afterLock = await httpJson(baseUrl, 'POST', '/api/v1/track', {
        body: { trackingId: 'MD-7K3Q9XTB', secret: canonicalSecret },
      });
      expect(afterLock.status).toBe(200);

      // Non-existent trackingId behaves identically (generic 401 -> 423 after 5 failures)
      for (let i = 0; i < 4; i += 1) {
        const missing = await httpJson(baseUrl, 'POST', '/api/v1/track', {
          body: { trackingId: 'MD-9999AAAA', secret: canonicalSecret },
        });
        expect(missing.status).toBe(401);
        expect((missing.json.error as { message: string }).message).toBe(
          'Invalid tracking ID or secret.',
        );
      }
      const missingLock = await httpJson(baseUrl, 'POST', '/api/v1/track', {
        body: { trackingId: 'MD-9999AAAA', secret: canonicalSecret },
      });
      expect(missingLock.status).toBe(423);
    });

    it('redacts moderator-edited original version text, internal moderator reason, and hidden/deleted content on tracking', async () => {
      const secret = '4F8QZ-N2M7C-KX9TA-W5H1R-D9P2E-Q';
      const { doc: redactedDoc } = seedIncident(state, {
        trackingId: 'MD-REDACT01',
        rawSecret: secret,
        title: 'Traffic confrontation near junction [redacted]',
        description: 'Person at crossing argued loudly with bus driver today. [redacted]',
        safetyTip: 'Use pedestrian bridge.',
        moderatedEdit: true,
        isEdited: true,
        editCount: 1,
        createdAt: new Date('2026-11-11T09:55:00.000Z'),
      });
      state.versions.push(
        {
          _id: new Types.ObjectId(),
          incidentId: redactedDoc._id,
          version: 1,
          title: 'Secret PII original title with 01712345678',
          description: 'Original doxxing description calling +8801712345678 directly.',
          safetyTip: 'Original tip calling private@example.com',
          editedAt: new Date('2026-11-11T09:56:00.000Z'),
          editedBy: 'reporter',
        },
        {
          _id: new Types.ObjectId(),
          incidentId: redactedDoc._id,
          version: 2,
          title: 'Second version before mod redacted 01712345678',
          description: 'Pre-redaction text with personal details from reporter.',
          safetyTip: 'Unsafe tip removed by moderator',
          editedAt: new Date('2026-11-11T09:57:00.000Z'),
          editedBy: 'moderator',
          reason: 'Internal mod note: actor abc12345 posted doxxing phone.',
        },
      );

      const redactedTrack = await httpJson(baseUrl, 'POST', '/api/v1/track', {
        body: { trackingId: 'MD-REDACT01', secret },
      });
      expect(redactedTrack.status).toBe(200);
      expect(redactedTrack.json.edit).toEqual({
        allowed: false,
        remainingSeconds: 0,
        editsLeft: 0,
      });

      const responseStr = JSON.stringify(redactedTrack.json);
      expect(responseStr).not.toContain('01712345678');
      expect(responseStr).not.toContain('private@example.com');
      expect(responseStr).not.toContain('Internal mod note');
      expect(responseStr).not.toContain('Pre-redaction text');

      const versions = redactedTrack.json.versions as Array<Record<string, unknown>>;
      expect(versions).toHaveLength(2);
      expect(versions[0]).toMatchObject({
        version: 1,
        title: '[Removed by moderators]',
        description: '[Removed by moderators]',
        safetyTip: null,
        editedBy: 'reporter',
        reason: null,
      });
      expect(versions[1]).toMatchObject({
        version: 2,
        title: '[Removed by moderators]',
        description: '[Removed by moderators]',
        safetyTip: null,
        editedBy: 'moderator',
        reason: null,
      });

      // Hidden incident: 404 publicly, sanitized text & versions on /track
      const { doc: hiddenDoc } = seedIncident(state, {
        trackingId: 'MD-H1DDEN02',
        rawSecret: secret,
        title: 'Secret hidden offensive title text',
        description: 'Secret hidden harmful body text that must never leak on track.',
        safetyTip: 'Hidden tip that should not appear',
        status: 'hidden',
        moderationOutcome: 'personal_data',
        hiddenAt: new Date('2026-11-11T09:58:00.000Z'),
      });
      state.versions.push({
        _id: new Types.ObjectId(),
        incidentId: hiddenDoc._id,
        version: 1,
        title: 'Previous hidden version title',
        description: 'Previous hidden version description',
        editedAt: new Date('2026-11-11T09:57:00.000Z'),
        editedBy: 'reporter',
      });

      const publicHidden = await httpJson(baseUrl, 'GET', '/api/v1/incidents/MD-H1DDEN02');
      expect(publicHidden.status).toBe(404);

      const hiddenTrack = await httpJson(baseUrl, 'POST', '/api/v1/track', {
        body: { trackingId: 'MD-H1DDEN02', secret },
      });
      expect(hiddenTrack.status).toBe(200);
      expect(hiddenTrack.json.status).toBe('hidden');
      expect(hiddenTrack.json.outcome).toBe('personal_data');
      expect(hiddenTrack.json.edit).toEqual({
        allowed: false,
        remainingSeconds: 0,
        editsLeft: 0,
      });
      const hiddenStr = JSON.stringify(hiddenTrack.json);
      expect(hiddenStr).not.toContain('Secret hidden offensive title text');
      expect(hiddenStr).not.toContain('Previous hidden version');
      expect(hiddenStr).not.toContain('hiddenAt');

      // Soft-deleted incident: 404 publicly, sanitized text & versions on /track, no deletedAt/purgeAt
      seedIncident(state, {
        trackingId: 'MD-DE2ET003',
        rawSecret: secret,
        title: 'Removed threatening title text',
        description: 'Removed threatening incident body that must never leak.',
        status: 'deleted',
        moderationOutcome: 'threats',
        deletedAt: new Date('2026-11-11T09:59:00.000Z'),
        purgeAt: new Date('2026-12-11T09:59:00.000Z'),
      });

      const publicDeleted = await httpJson(baseUrl, 'GET', '/api/v1/incidents/MD-DE2ET003');
      expect(publicDeleted.status).toBe(404);

      const deletedTrack = await httpJson(baseUrl, 'POST', '/api/v1/track', {
        body: { trackingId: 'MD-DE2ET003', secret },
      });
      expect(deletedTrack.status).toBe(200);
      expect(deletedTrack.json.status).toBe('deleted');
      expect(deletedTrack.json.outcome).toBe('threats');
      const deletedStr = JSON.stringify(deletedTrack.json);
      expect(deletedStr).not.toContain('Removed threatening title text');
      expect(deletedStr).not.toContain('purgeAt');
      expect(deletedStr).not.toContain('deletedAt');
    });
  });

  describe('2. Quick Edit rules, moderation guard & concurrency safety', () => {
    it('enforces locked fields, validation-before-consume, safetyTip 30% Levenshtein, 3-edit cap & 15m window', async () => {
      const secret = '4F8QZ-N2M7C-KX9TA-W5H1R-D9P2E-Q';
      const createdAt = new Date('2026-11-11T10:00:00.000Z');
      vi.setSystemTime(createdAt);

      const { doc } = seedIncident(state, {
        trackingId: 'MD-ED1T0001',
        rawSecret: secret,
        title: 'Broken signal at Dhaka crossing',
        description: 'Traffic signal light stopped working since morning near crossing.',
        safetyTip: 'Use the service road carefully',
        createdAt,
      });

      // Locked fields -> 400 VALIDATION_ERROR without burning edits
      for (const lockedPayload of [
        { secret, title: 'Broken signal at Dhaka crossing', category: 'other' },
        {
          secret,
          title: 'Broken signal at Dhaka crossing',
          location: { lat: 23.82, lng: 90.42 },
        },
        {
          secret,
          title: 'Broken signal at Dhaka crossing',
          incidentAt: createdAt.toISOString(),
        },
      ]) {
        const res = await httpJson(baseUrl, 'PATCH', '/api/v1/incidents/MD-ED1T0001', {
          body: lockedPayload,
        });
        expect(res.status).toBe(400);
        expect((res.json.error as { code: string }).code).toBe(
          ERROR_CODES.VALIDATION_ERROR,
        );
      }
      expect(doc.editCount).toBe(0);
      expect(state.versions).toHaveLength(0);

      // Failed contact info & >30% title/description/safetyTip checks do NOT consume editCount
      const contactEdit = await httpJson(baseUrl, 'PATCH', '/api/v1/incidents/MD-ED1T0001', {
        body: {
          secret,
          safetyTip: 'Call ০১৭১২৩৪৫৬৭৮ near service road',
        },
      });
      expect(contactEdit.status).toBe(400);
      expect((contactEdit.json.error as { details: { reason: string } }).details.reason).toBe(
        'CONTACT_INFO_NOT_ALLOWED',
      );
      expect(doc.editCount).toBe(0);

      // Removing non-empty safetyTip triggers >30% Levenshtein violation
      const wipeTip = await httpJson(baseUrl, 'PATCH', '/api/v1/incidents/MD-ED1T0001', {
        body: { secret, safetyTip: null },
      });
      expect(wipeTip.status).toBe(400);
      expect((wipeTip.json.error as { details: { reason: string } }).details.reason).toBe(
        'CHANGE_TOO_LARGE',
      );
      expect(doc.editCount).toBe(0);
      expect(state.versions).toHaveLength(0);

      // >30% title change rejected without burning attempt
      const bigTitleEdit = await httpJson(baseUrl, 'PATCH', '/api/v1/incidents/MD-ED1T0001', {
        body: { secret, title: 'Completely unrelated brand new heading text' },
      });
      expect(bigTitleEdit.status).toBe(400);
      expect(doc.editCount).toBe(0);

      // 3 valid <=30% edits succeed (including safetyTip update + Bangla ZWJ/ZWNJ preservation)
      const edit1 = await httpJson(baseUrl, 'PATCH', '/api/v1/incidents/MD-ED1T0001', {
        body: {
          secret,
          title: 'Broken signal by Dhaka crossing',
          safetyTip: 'Use the service lane carefully',
        },
      });
      expect(edit1.status).toBe(200);
      expect(edit1.res.headers.get('cache-control')).toBe('no-store');
      expect((edit1.json.incident as { isEdited: boolean }).isEdited).toBe(true);
      expect((edit1.json.incident as { safetyTip: string }).safetyTip).toBe(
        'Use the service lane carefully',
      );
      expect((edit1.json.edit as { editsLeft: number }).editsLeft).toBe(2);
      expect(state.versions).toHaveLength(1);
      expect(state.versions[0]!.safetyTip).toBe('Use the service road carefully');

      const edit2 = await httpJson(baseUrl, 'PATCH', '/api/v1/incidents/MD-ED1T0001', {
        body: {
          secret,
          description:
            'Traffic signal light stopped working since evening near crossing.',
        },
      });
      expect(edit2.status).toBe(200);
      expect((edit2.json.edit as { editsLeft: number }).editsLeft).toBe(1);

      const edit3 = await httpJson(baseUrl, 'PATCH', '/api/v1/incidents/MD-ED1T0001', {
        body: {
          secret,
          title: 'Broken signal at Dhaka\u200D crossing',
        },
      });
      expect(edit3.status).toBe(200);
      expect((edit3.json.incident as { title: string }).title).toBe(
        'Broken signal at Dhaka\u200D crossing',
      );
      expect((edit3.json.edit as { allowed: boolean; editsLeft: number }).allowed).toBe(false);
      expect((edit3.json.edit as { editsLeft: number }).editsLeft).toBe(0);
      expect(state.versions).toHaveLength(3);

      // 4th edit -> 403 EDIT_LIMIT_REACHED
      const edit4 = await httpJson(baseUrl, 'PATCH', '/api/v1/incidents/MD-ED1T0001', {
        body: { secret, title: 'Broken signal by Dhaka\u200D crossing' },
      });
      expect(edit4.status).toBe(403);
      expect((edit4.json.error as { code: string }).code).toBe(
        ERROR_CODES.EDIT_LIMIT_REACHED,
      );

      // Window boundary: succeeds at +14m59s, fails at +15m01s
      seedIncident(state, {
        trackingId: 'MD-W1ND0W02',
        rawSecret: secret,
        title: 'Flooding blocking local road',
        createdAt,
      });

      vi.setSystemTime(new Date(createdAt.getTime() + 14 * 60 * 1000 + 59 * 1000));
      const inWindow = await httpJson(baseUrl, 'PATCH', '/api/v1/incidents/MD-W1ND0W02', {
        body: { secret, title: 'Flooding blocking main road' },
      });
      expect(inWindow.status).toBe(200);

      vi.setSystemTime(new Date(createdAt.getTime() + 15 * 60 * 1000 + 1000));
      const afterWindow = await httpJson(baseUrl, 'PATCH', '/api/v1/incidents/MD-W1ND0W02', {
        body: { secret, title: 'Flooding blocking side road' },
      });
      expect(afterWindow.status).toBe(403);
      expect((afterWindow.json.error as { code: string }).code).toBe(
        ERROR_CODES.EDIT_WINDOW_CLOSED,
      );
    });

    it('blocks quick edits after moderator redaction and guarantees concurrent edits cannot exceed 3 or leave orphan snapshots', async () => {
      const secret = '4F8QZ-N2M7C-KX9TA-W5H1R-D9P2E-Q';

      // Moderated published incident cannot be overwritten via quick edit
      seedIncident(state, {
        trackingId: 'MD-M0DED1T1',
        rawSecret: secret,
        moderatedEdit: true,
        editCount: 0,
      });
      const modBlocked = await httpJson(baseUrl, 'PATCH', '/api/v1/incidents/MD-M0DED1T1', {
        body: { secret, title: 'Broken signal blocking local traffic' },
      });
      expect(modBlocked.status).toBe(403);
      expect((modBlocked.json.error as { code: string }).code).toBe(ERROR_CODES.FORBIDDEN);

      // Hidden/deleted incidents cannot be edited
      seedIncident(state, {
        trackingId: 'MD-H1DED2T2',
        rawSecret: secret,
        status: 'hidden',
      });
      const hiddenBlocked = await httpJson(baseUrl, 'PATCH', '/api/v1/incidents/MD-H1DED2T2', {
        body: { secret, title: 'Broken signal blocking local traffic' },
      });
      expect(hiddenBlocked.status).toBe(403);

      // Concurrency test 1: 2 overlapping parallel edits at editCount=2 (1 edit remaining) => 1 wins (200), 1 fails (409)
      const { doc: raceDoc } = seedIncident(state, {
        trackingId: 'MD-RACE0001',
        rawSecret: secret,
        title: 'Broken signal at Uttara sector',
        editCount: 2,
      });

      let arrived = 0;
      let releaseBoth!: () => void;
      const bothReadSameState = new Promise<void>((resolve) => {
        releaseBoth = resolve;
      });
      state.afterFindOne = async () => {
        arrived += 1;
        if (arrived === 2) {
          releaseBoth();
        }
        await bothReadSameState;
      };

      const [r1, r2] = await Promise.all([
        httpJson(baseUrl, 'PATCH', '/api/v1/incidents/MD-RACE0001', {
          body: { secret, title: 'Broken signal by Uttara sector' },
        }),
        httpJson(baseUrl, 'PATCH', '/api/v1/incidents/MD-RACE0001', {
          body: { secret, title: 'Broken signal in Uttara sector' },
        }),
      ]);
      state.afterFindOne = undefined;

      const statuses = [r1.status, r2.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);
      expect(raceDoc.editCount).toBe(3);
      expect(state.versions.filter((v) => v.incidentId.toString() === raceDoc._id.toString())).toHaveLength(1);

      // Concurrency test 2: moderator sets moderatedEdit=true mid-flight before conditional update => 409 + no orphan version
      const { doc: modRaceDoc } = seedIncident(state, {
        trackingId: 'MD-M0DRACE2',
        rawSecret: secret,
        title: 'Broken signal near junction',
        editCount: 0,
      });
      state.beforeFindOneAndUpdate = () => {
        modRaceDoc.moderatedEdit = true;
      };

      const modRaceRes = await httpJson(baseUrl, 'PATCH', '/api/v1/incidents/MD-M0DRACE2', {
        body: { secret, title: 'Broken signal over junction' },
      });
      state.beforeFindOneAndUpdate = undefined;
      expect(modRaceRes.status).toBe(409);
      expect((modRaceRes.json.error as { code: string }).code).toBe(
        ERROR_CODES.DUPLICATE_ACTION,
      );
      expect(modRaceDoc.editCount).toBe(0);
      expect(
        state.versions.filter((v) => v.incidentId.toString() === modRaceDoc._id.toString()),
      ).toHaveLength(0);
    });
  });

  describe('3. Feed, Cursor Pagination, Filters, Nearest & Map API', () => {
    it('enforces published-only visibility, default 20-item feed cap, deterministic cursor pagination across duplicate timestamps, filters & malformed cursor rejection', async () => {
      // Seed 25 published incidents with clusters sharing exact createdAt timestamps
      const baseTime = new Date('2026-11-10T10:00:00.000Z');
      for (let i = 0; i < 25; i += 1) {
        const groupMinute = Math.floor(i / 5);
        const trackingSuffix = String(i).padStart(2, '0');
        seedIncident(state, {
          _id: new Types.ObjectId(
            `6731a0c2f1d2a3b4c5d6e0${trackingSuffix}`,
          ),
          trackingId: `MD-FEED00${trackingSuffix}`,
          title: i === 7 ? 'চাঁদাবাজি ও যানজট মিরপুরে' : `Traffic incident number ${trackingSuffix}`,
          description:
            i === 7
              ? 'মিরপুর ১০ নম্বরে রাস্তার মাঝে অবৈধ বাধা সৃষ্টি হয়েছে।'
              : `Detailed incident description number ${trackingSuffix} near Dhaka main road.`,
          category: i % 2 === 0 ? 'road_accident' : 'traffic_violation',
          district: i < 15 ? 'Dhaka' : 'Chattogram',
          createdAt: new Date(baseTime.getTime() + groupMinute * 60 * 1000),
        });
      }

      // Add hidden & deleted incidents that must NEVER appear
      seedIncident(state, {
        trackingId: 'MD-H1DDEN99',
        title: 'Traffic incident hidden',
        status: 'hidden',
        district: 'Dhaka',
      });
      seedIncident(state, {
        trackingId: 'MD-DELET099',
        title: 'Traffic incident deleted',
        status: 'deleted',
        district: 'Dhaka',
      });

      // Non-bbox feed caps limit at PAGING.DEFAULT (20) even if limit=100 is passed
      const page1 = await httpJson(baseUrl, 'GET', '/api/v1/incidents?limit=100');
      expect(page1.status).toBe(200);
      expect(page1.json.truncated).toBe(false);
      const items1 = page1.json.items as Array<{ trackingId: string }>;
      expect(items1).toHaveLength(PAGING.DEFAULT);
      expect(page1.json.nextCursor).toBeTypeOf('string');
      expect(JSON.stringify(page1.json)).not.toContain('MD-H1DDEN99');
      expect(JSON.stringify(page1.json)).not.toContain('MD-DELET099');
      expect(JSON.stringify(page1.json)).not.toContain('secretHash');
      expect(JSON.stringify(page1.json)).not.toContain('actorId');
      expect(JSON.stringify(page1.json)).not.toContain('contentHash');

      const page2 = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/incidents?cursor=${encodeURIComponent(page1.json.nextCursor as string)}`,
      );
      expect(page2.status).toBe(200);
      const items2 = page2.json.items as Array<{ trackingId: string }>;
      expect(items2).toHaveLength(5);
      expect(page2.json.nextCursor).toBeNull();

      // Zero skips, zero duplicates across duplicate createdAt ties
      const seenNewest = [...items1, ...items2].map((i) => i.trackingId);
      expect(new Set(seenNewest).size).toBe(25);

      // Sort oldest across cursor pages too
      const old1 = await httpJson(baseUrl, 'GET', '/api/v1/incidents?sort=oldest');
      const old2 = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/incidents?sort=oldest&cursor=${encodeURIComponent(old1.json.nextCursor as string)}`,
      );
      const seenOldest = [
        ...(old1.json.items as Array<{ trackingId: string }>),
        ...(old2.json.items as Array<{ trackingId: string }>),
      ].map((i) => i.trackingId);
      expect(seenOldest).toEqual([...seenNewest].reverse());

      // Filters: Bangla text search, case-insensitive district, multi-category, from/to
      const banglaSearch = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/incidents?q=${encodeURIComponent('মিরপুর')}`,
      );
      expect(banglaSearch.status).toBe(200);
      expect((banglaSearch.json.items as Array<{ trackingId: string }>).map((i) => i.trackingId)).toEqual([
        'MD-FEED0007',
      ]);

      // All-bidi-override q doesn't crash or pass empty $text
      const bidiOnlySearch = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/incidents?q=${encodeURIComponent('\u202E')}`,
      );
      expect(bidiOnlySearch.status).toBe(200);

      const multiCatDistrict = await httpJson(
        baseUrl,
        'GET',
        '/api/v1/incidents?district=dhaka&category=traffic_violation',
      );
      expect(multiCatDistrict.status).toBe(200);
      expect((multiCatDistrict.json.items as unknown[]).length).toBe(7);

      // Empty result cleanly returns nextCursor: null, truncated: false
      const emptyRes = await httpJson(
        baseUrl,
        'GET',
        '/api/v1/incidents?from=2030-01-01T00:00:00.000Z',
      );
      expect(emptyRes.status).toBe(200);
      expect(emptyRes.json).toEqual({
        items: [],
        nextCursor: null,
        truncated: false,
      });

      // Malformed cursors rejected with 400 VALIDATION_ERROR
      const twelveCharCursor = Buffer.from(
        JSON.stringify({ c: baseTime.toISOString(), i: '123456789012' }),
        'utf8',
      ).toString('base64url');
      for (const badCursor of ['bad@@cursor', twelveCharCursor]) {
        const res = await httpJson(
          baseUrl,
          'GET',
          `/api/v1/incidents?cursor=${encodeURIComponent(badCursor)}`,
        );
        expect(res.status).toBe(400);
        expect((res.json.error as { code: string }).code).toBe(
          ERROR_CODES.VALIDATION_ERROR,
        );
      }
    });

    it('finds true nearest incidents even when >100 newer docs exist in radius, caps at 100, and rejects cursor/invalid near params', async () => {
      const originLat = 23.81033;
      const originLng = 90.41252;
      const now = new Date('2026-11-11T10:00:00.000Z');

      // Seed 102 NEWER incidents ~4.5 km away (lng + 0.044)
      for (let i = 0; i < 102; i += 1) {
        seedIncident(state, {
          _id: new Types.ObjectId(`6731b0c2f1d2a3b4c5d60${String(i).padStart(3, '0')}`),
          trackingId: `MD-FAR${String(i).padStart(5, '0')}`,
          location: { type: 'Point', coordinates: [originLng + 0.044, originLat] },
          createdAt: new Date(now.getTime() - i * 1000),
        });
      }

      // Seed 3 SLIGHTLY OLDER incidents ~0.2..0.8 km away — previous bug dropped these completely!
      seedIncident(state, {
        trackingId: 'MD-NEAR0002',
        location: { type: 'Point', coordinates: [originLng + 0.005, originLat] }, // ~0.51 km
        createdAt: new Date(now.getTime() - 60 * 60 * 1000),
      });
      seedIncident(state, {
        trackingId: 'MD-NEAR0001',
        title: 'Nearest collision hazard at junction',
        category: 'road_accident',
        location: { type: 'Point', coordinates: [originLng + 0.001, originLat] }, // ~0.10 km
        createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      });
      // Also hidden closer doc that must never appear
      seedIncident(state, {
        trackingId: 'MD-NEARH1DE',
        status: 'hidden',
        location: { type: 'Point', coordinates: [originLng, originLat] },
        createdAt: now,
      });

      const nearestRes = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/incidents?near=${originLat},${originLng}&radiusKm=10&sort=nearest&limit=120`,
      );
      expect(nearestRes.status).toBe(200);
      expect(nearestRes.json.nextCursor).toBeNull();
      expect(nearestRes.json.truncated).toBe(false);

      const items = nearestRes.json.items as Array<{
        trackingId: string;
        distanceKm: number;
      }>;
      expect(items).toHaveLength(PAGING.NEAREST_MAX);
      expect(items[0]!.trackingId).toBe('MD-NEAR0001');
      expect(items[1]!.trackingId).toBe('MD-NEAR0002');
      expect(items[0]!.distanceKm).toBeLessThanOrEqual(items[1]!.distanceKm);
      expect(items[1]!.distanceKm).toBeLessThan(items[2]!.distanceKm);
      expect(items.some((i) => i.trackingId === 'MD-NEARH1DE')).toBe(false);

      const combinedNearest = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/incidents?near=${originLat},${originLng}&radiusKm=10&sort=nearest&category=road_accident&q=collision`,
      );
      expect(combinedNearest.status).toBe(200);
      expect((combinedNearest.json.items as Array<{ trackingId: string }>).map((i) => i.trackingId)).toEqual([
        'MD-NEAR0001',
      ]);

      // Invalid nearest queries -> 400 VALIDATION_ERROR
      for (const badPath of [
        '/api/v1/incidents?sort=nearest',
        `/api/v1/incidents?near=${originLat},${originLng}&sort=nearest&cursor=abc`,
        '/api/v1/incidents?near=23.81,&sort=nearest',
        '/api/v1/incidents?near=10.0,90.4&sort=nearest',
        `/api/v1/incidents?near=${originLat},${originLng}&sort=nearest&radiusKm=51`,
      ]) {
        const res = await httpJson(baseUrl, 'GET', badPath);
        expect(res.status).toBe(400);
        expect((res.json.error as { code: string }).code).toBe(
          ERROR_CODES.VALIDATION_ERROR,
        );
      }
    });

    it('enforces Map API bbox 500-item limit, truncated flag, filtering & rejects empty/malformed bbox segments', async () => {
      const baseTime = new Date('2026-11-11T08:00:00.000Z');
      // Seed 502 published inside box [90.30, 23.70, 90.50, 23.95] + 1 outside + 1 hidden inside
      for (let i = 0; i < 502; i += 1) {
        const code = String(i).padStart(4, '0');
        seedIncident(state, {
          trackingId: `MD-MAP0${code}`,
          location: { type: 'Point', coordinates: [90.4, 23.8] },
          category: 'infrastructure',
          createdAt: new Date(baseTime.getTime() + i * 1000),
        });
      }
      seedIncident(state, {
        trackingId: 'MD-MAPOUT01',
        location: { type: 'Point', coordinates: [91.5, 24.5] },
      });
      seedIncident(state, {
        trackingId: 'MD-MAPHIDE1',
        status: 'hidden',
        location: { type: 'Point', coordinates: [90.4, 23.8] },
      });

      const truncatedMap = await httpJson(
        baseUrl,
        'GET',
        '/api/v1/incidents?bbox=90.30,23.70,90.50,23.95&limit=500',
      );
      expect(truncatedMap.status).toBe(200);
      expect(truncatedMap.json.truncated).toBe(true);
      const mapItems = truncatedMap.json.items as Array<{ trackingId: string }>;
      expect(mapItems).toHaveLength(PAGING.MAP_MAX);
      expect(mapItems[0]!.trackingId).toBe('MD-MAP00501'); // newest first
      expect(mapItems.some((i) => i.trackingId === 'MD-MAPOUT01')).toBe(false);
      expect(mapItems.some((i) => i.trackingId === 'MD-MAPHIDE1')).toBe(false);

      // When <= 500 match inside another box, truncated is false
      seedIncident(state, {
        trackingId: 'MD-SMALLBX1',
        category: 'public_safety',
        location: { type: 'Point', coordinates: [90.1, 23.1] },
      });
      const smallMap = await httpJson(
        baseUrl,
        'GET',
        '/api/v1/incidents?bbox=90.00,23.00,90.20,23.20&category=public_safety',
      );
      expect(smallMap.status).toBe(200);
      expect(smallMap.json.truncated).toBe(false);
      expect((smallMap.json.items as Array<{ trackingId: string }>).map((i) => i.trackingId)).toEqual([
        'MD-SMALLBX1',
      ]);

      // Reject empty CSV parts (previously coerced "" -> 0!), reversed coords, or limit > 500
      for (const badBbox of [
        '/api/v1/incidents?bbox=90.30,,90.50,23.95',
        '/api/v1/incidents?bbox=,23.70,90.50,23.95',
        '/api/v1/incidents?bbox=90.50,23.70,90.30,23.95',
        '/api/v1/incidents?bbox=90.30,23.70,90.50,23.95&limit=501',
      ]) {
        const res = await httpJson(baseUrl, 'GET', badBbox);
        expect(res.status).toBe(400);
        expect((res.json.error as { code: string }).code).toBe(
          ERROR_CODES.VALIDATION_ERROR,
        );
      }
    });
  });

  describe('4. Content Integrity across Create and Quick Edit', () => {
    it('maintains canonical contentHash from creation through quick edit and detects duplicate re-post', async () => {
      const browserToken = generateBrowserToken();
      const actorId = computeActorId(browserToken, process.env.ACTOR_HMAC_SECRET!);
      const cookie = `${ACTOR_COOKIE.name}=${browserToken}`;

      const createRes = await httpJson(baseUrl, 'POST', '/api/v1/incidents', {
        cookie,
        body: {
          title: 'Initial road hazard near Motijheel',
          description: 'A large pothole has opened near the main crossing causing delays.',
          category: 'infrastructure',
          incidentAt: '2026-11-11T09:30:00.000Z',
          location: { lat: 23.733, lng: 90.4172 },
          captchaToken: 'valid-turnstile-token',
        },
      });
      expect(createRes.status).toBe(201);
      const credentials = createRes.json.credentials as {
        trackingId: string;
        secret: string;
      };
      const stored = state.incidents.find(
        (i) => i.trackingId === credentials.trackingId,
      )!;
      expect(stored.actorId).toBe(actorId);
      expect(stored.contentHash).toBe(
        computeIncidentContentHash({
          title: 'Initial road hazard near Motijheel',
          description: 'A large pothole has opened near the main crossing causing delays.',
        }),
      );

      // Quick edit updates title/description and recomputes matching contentHash
      const newTitle = 'Initial road hazard near Gulistan';
      const editRes = await httpJson(
        baseUrl,
        'PATCH',
        `/api/v1/incidents/${credentials.trackingId}`,
        {
          body: {
            secret: credentials.secret,
            title: newTitle,
          },
        },
      );
      expect(editRes.status).toBe(200);
      expect(stored.contentHash).toBe(
        computeIncidentContentHash({
          title: newTitle,
          description: stored.description,
        }),
      );

      // Duplicate submission matching updated contentHash within 24h by same actor -> 409 DUPLICATE_ACTION
      const dupRes = await httpJson(baseUrl, 'POST', '/api/v1/incidents', {
        cookie,
        body: {
          title: `  ${newTitle}\u202E `,
          description: stored.description,
          category: 'infrastructure',
          incidentAt: '2026-11-11T09:45:00.000Z',
          location: { lat: 23.733, lng: 90.4172 },
          captchaToken: 'valid-turnstile-token',
        },
      });
      expect(dupRes.status).toBe(409);
      expect((dupRes.json.error as { code: string }).code).toBe(
        ERROR_CODES.DUPLICATE_ACTION,
      );
    });
  });
});
