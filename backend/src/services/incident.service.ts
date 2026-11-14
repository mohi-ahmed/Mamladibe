import type { Types } from 'mongoose';
import { EDIT, ERROR_CODES, LIMITS, PAGING, PATTERNS, RATE, SEARCH } from '../constants/index.js';
import { verifyTurnstileToken } from '../lib/captcha.js';
import { decodeCursor, encodeCursor } from '../lib/cursor.js';
import { addMinutes } from '../lib/dhaka-time.js';
import { computeChangeRatio } from '../lib/levenshtein.js';
import {
  acquireIncidentDuplicateLock,
  assertTrackNotLocked,
  clearTrackFailures,
  consumeIncidentCreateLimit,
  recordTrackFailure,
  releaseIncidentDuplicateLock,
} from '../lib/ratelimit.js';
import {
  assertNoContactInfo,
  computeIncidentContentHash,
  createExcerpt,
  normalizeContentText,
  normalizeOptionalContentText,
} from '../lib/text-rules.js';
import {
  generateReporterSecret,
  generateTrackingId,
  verifyReporterSecret,
} from '../lib/tracking.js';
import {
  CommentModel,
  IncidentModel,
  IncidentVersionModel,
  ReportModel,
  VoteModel,
} from '../models/index.js';
import type { IIncident, IncidentCategory } from '../types/index.js';
import {
  AppError,
  duplicateActionError,
  editLimitReachedError,
  editWindowClosedError,
  forbiddenError,
  internalError,
  lockedError,
  notFoundError,
  rateLimitedError,
  unauthorizedError,
  validationError,
} from '../utils/errors.js';
import { isWithinBangladeshBounds, roundCoordinate } from '../utils/geo.js';
import type {
  CreateIncidentInput,
  ListIncidentsQuery,
  QuickEditInput,
} from '../validators/public.validator.js';
import { recordAbuseSignal } from './abuse-signal.service.js';
import { ensureActorCanPerform } from './actor.service.js';
import { assertPostingNotFrozen } from './settings.service.js';

type IncidentLean = IIncident & { _id: Types.ObjectId };

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)));
}

function toCoordinatesObject(location: IIncident['location']): {
  lat: number;
  lng: number;
} {
  const [lng, lat] = location.coordinates;
  return { lat, lng };
}

async function computeCommentCountsByIncidentId(
  incidentIds: Types.ObjectId[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (incidentIds.length === 0) {
    return map;
  }

  const rows = await CommentModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    {
      $match: {
        incidentId: { $in: incidentIds },
        status: 'published',
      },
    },
    {
      $group: {
        _id: '$incidentId',
        count: { $sum: 1 },
      },
    },
  ]);

  for (const row of rows) {
    map.set(row._id.toString(), row.count);
  }
  return map;
}

type IncidentCounts = {
  support: number;
  dispute: number;
  flags: number;
  comments: number;
};

async function computeIncidentCountsByIncidentId(
  incidentIds: Types.ObjectId[],
): Promise<Map<string, IncidentCounts>> {
  const counts = new Map<string, IncidentCounts>();
  if (incidentIds.length === 0) return counts;

  const [voteRows, reportRows, commentCounts] = await Promise.all([
    VoteModel.aggregate<{
      _id: { incidentId: Types.ObjectId; type: 'support' | 'dispute' };
      count: number;
    }>([
      { $match: { incidentId: { $in: incidentIds } } },
      { $group: { _id: { incidentId: '$incidentId', type: '$type' }, count: { $sum: 1 } } },
    ]),
    ReportModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { targetType: 'incident', targetId: { $in: incidentIds } } },
      { $group: { _id: '$targetId', count: { $sum: 1 } } },
    ]),
    computeCommentCountsByIncidentId(incidentIds),
  ]);

  for (const incidentId of incidentIds) {
    counts.set(incidentId.toString(), {
      support: 0,
      dispute: 0,
      flags: 0,
      comments: commentCounts.get(incidentId.toString()) ?? 0,
    });
  }
  for (const row of voteRows) {
    const entry = counts.get(row._id.incidentId.toString());
    if (entry) entry[row._id.type] = row.count;
  }
  for (const row of reportRows) {
    const entry = counts.get(row._id.toString());
    if (entry) entry.flags = row.count;
  }
  return counts;
}

export async function getIncidentCounts(incidentId: Types.ObjectId): Promise<{
  support: number;
  dispute: number;
  flags: number;
  comments: number;
}> {
  const [voteRows, flags, comments] = await Promise.all([
    VoteModel.aggregate<{ _id: 'support' | 'dispute'; count: number }>([
      { $match: { incidentId } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
    ReportModel.countDocuments({
      targetType: 'incident',
      targetId: incidentId,
    }),
    CommentModel.countDocuments({
      incidentId,
      status: 'published',
    }),
  ]);

  let support = 0;
  let dispute = 0;
  for (const row of voteRows) {
    if (row._id === 'support') support = row.count;
    if (row._id === 'dispute') dispute = row.count;
  }

  return { support, dispute, flags, comments };
}

function formatPublicIncidentDetail(
  doc: IncidentLean,
  counts: IncidentCounts,
  my: { vote: 'support' | 'dispute' | null; flagged: boolean },
) {
  return {
    trackingId: doc.trackingId,
    title: doc.title,
    description: doc.description,
    category: doc.category,
    incidentAt: doc.incidentAt.toISOString(),
    createdAt: doc.createdAt.toISOString(),
    location: toCoordinatesObject(doc.location),
    roadName: doc.roadName ?? null,
    areaName: doc.areaName ?? null,
    upazila: doc.upazila ?? null,
    district: doc.district ?? null,
    safetyTip: doc.safetyTip ?? null,
    isEdited: doc.isEdited,
    editedAt: doc.editedAt ? doc.editedAt.toISOString() : null,
    moderatedEdit: doc.moderatedEdit,
    source: doc.source,
    counts,
    my,
  };
}

function formatPublicIncidentListItem(
  doc: IncidentLean,
  counts: IncidentCounts,
  distanceKm?: number,
) {
  return {
    ...formatPublicIncidentDetail(doc, counts, { vote: null, flagged: false }),
    excerpt: createExcerpt(doc.description, LIMITS.EXCERPT_MAX_CHARS),
    ...(distanceKm === undefined
      ? {}
      : { distanceKm: Math.round(distanceKm * 100) / 100 }),
  };
}

export async function createPublicIncident(
  input: CreateIncidentInput,
  context: { actorId: string; ipHash?: string; clientIp?: string },
) {
  if (!context.ipHash || !PATTERNS.IP_HASH_HEX.test(context.ipHash)) {
    throw internalError('IP hash is required for incident submission.', 500);
  }

  // 1. Normalize and validate all request fields before actor write, CAPTCHA, or quota consumption.
  const title = normalizeContentText(input.title);
  const description = normalizeContentText(input.description);
  const safetyTip = normalizeOptionalContentText(input.safetyTip);
  const roadName = normalizeOptionalContentText(input.roadName);
  const areaName = normalizeOptionalContentText(input.areaName);
  const upazila = normalizeOptionalContentText(input.upazila);
  const district = normalizeOptionalContentText(input.district);

  if (title.length < LIMITS.TITLE.min || title.length > LIMITS.TITLE.max) {
    throw validationError('Incident title length is invalid.', {
      fields: [{ path: 'title', message: 'Title length is out of range.' }],
    });
  }
  if (
    description.length < LIMITS.DESCRIPTION.min ||
    description.length > LIMITS.DESCRIPTION.max
  ) {
    throw validationError('Incident description length is invalid.', {
      fields: [
        { path: 'description', message: 'Description length is out of range.' },
      ],
    });
  }
  if (safetyTip && safetyTip.length > LIMITS.SAFETY_TIP_MAX) {
    throw validationError('Safety tip exceeds maximum length.', {
      fields: [
        { path: 'safetyTip', message: 'Safety tip length is out of range.' },
      ],
    });
  }

  const oversizedPlaceFields: Array<{ path: string; message: string }> = [];
  for (const [path, val] of [
    ['roadName', roadName],
    ['areaName', areaName],
    ['upazila', upazila],
    ['district', district],
  ] as const) {
    if (val && val.length > LIMITS.PLACE_TEXT_MAX) {
      oversizedPlaceFields.push({
        path,
        message: 'Location text length is out of range.',
      });
    }
  }
  if (oversizedPlaceFields.length > 0) {
    throw validationError('Location text exceeds maximum length.', {
      fields: oversizedPlaceFields,
    });
  }

  assertNoContactInfo({
    title,
    description,
    safetyTip,
    roadName,
    areaName,
    upazila,
    district,
  });

  const now = new Date();
  const incidentAt = new Date(input.incidentAt);
  const oldestAllowedMs =
    now.getTime() - LIMITS.INCIDENT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

  if (Number.isNaN(incidentAt.getTime()) || incidentAt.getTime() > now.getTime()) {
    throw validationError('Incident time cannot be in the future.', {
      fields: [
        { path: 'incidentAt', message: 'Incident time cannot be in the future.' },
      ],
    });
  }
  if (incidentAt.getTime() < oldestAllowedMs) {
    throw validationError(
      `Incident time cannot be older than ${LIMITS.INCIDENT_MAX_AGE_DAYS} days.`,
      {
        fields: [
          {
            path: 'incidentAt',
            message: `Incident time must be within the last ${LIMITS.INCIDENT_MAX_AGE_DAYS} days.`,
          },
        ],
      },
    );
  }

  const roundedCoords: [number, number] = [
    roundCoordinate(input.location.lng),
    roundCoordinate(input.location.lat),
  ];

  if (!isWithinBangladeshBounds(roundedCoords)) {
    throw validationError('Location must be within Bangladesh bounds.', {
      fields: [
        {
          path: 'location',
          message: 'Coordinates must lie within Bangladesh bounds.',
        },
      ],
    });
  }

  // 2. Enforce actor restrictions and global posting freeze before CAPTCHA or quota consumption.
  await ensureActorCanPerform(context.actorId, 'post');
  await assertPostingNotFrozen();

  // 3. Always require Turnstile verification on incident creation before consuming quota.
  try {
    await verifyTurnstileToken(input.captchaToken, context.clientIp);
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.CAPTCHA_REQUIRED) {
      await recordAbuseSignal({
        ipHash: context.ipHash,
        actorId: context.actorId,
        type: 'captcha_failed',
      });
    }
    throw error;
  }

  // 4. Enforce 24h per-actor duplicate detection (PRD contentHash = sha256(title + '\n' + description))
  //    plus atomic in-flight dedup lock so concurrent identical requests cannot double-create or burn quota.
  const contentHash = computeIncidentContentHash({ title, description });
  const duplicateCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const duplicateExists = await IncidentModel.exists({
    actorId: context.actorId,
    contentHash,
    createdAt: { $gte: duplicateCutoff },
    status: { $ne: 'deleted' },
  });

  if (duplicateExists) {
    await recordAbuseSignal({
      ipHash: context.ipHash,
      actorId: context.actorId,
      type: 'duplicate_incident',
    });
    throw duplicateActionError(
      'A duplicate report was already submitted from this browser in the last 24 hours.',
    );
  }

  const acquiredDupLock = await acquireIncidentDuplicateLock(
    context.actorId,
    contentHash,
  );
  if (!acquiredDupLock) {
    await recordAbuseSignal({
      ipHash: context.ipHash,
      actorId: context.actorId,
      type: 'duplicate_incident',
    });
    throw duplicateActionError(
      'A duplicate report was already submitted from this browser in the last 24 hours.',
    );
  }

  let persisted = false;
  try {
    // 5. Consume rolling 24h per-actor quota atomically after validation, CAPTCHA, and duplicate checks.
    const rateResult = await consumeIncidentCreateLimit(context.actorId);
    if (!rateResult.allowed) {
      await recordAbuseSignal({
        ipHash: context.ipHash,
        actorId: context.actorId,
        type: 'rate_limit_hit',
      });
      throw rateLimitedError(
        'You have reached the 24-hour incident submission limit.',
        { retryAfterSeconds: rateResult.retryAfterSeconds ?? 3600 },
      );
    }

    const { formattedSecret, secretHash } = generateReporterSecret();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const trackingId = generateTrackingId();
      try {
        const created = await IncidentModel.create({
          trackingId,
          secretHash,
          title,
          description,
          category: input.category,
          incidentAt,
          location: {
            type: 'Point',
            coordinates: roundedCoords,
          },
          ...(roadName ? { roadName } : {}),
          ...(areaName ? { areaName } : {}),
          ...(upazila ? { upazila } : {}),
          ...(district ? { district } : {}),
          ...(safetyTip ? { safetyTip } : {}),
          status: 'published',
          isEdited: false,
          editCount: 0,
          moderatedEdit: false,
          source: 'public',
          actorId: context.actorId,
          contentHash,
          createdAt: now,
        });

        persisted = true;
        const createdPlain = created.toObject() as IncidentLean;
        return {
          incident: formatPublicIncidentDetail(
            createdPlain,
            { support: 0, dispute: 0, flags: 0, comments: 0 },
            { vote: null, flagged: false },
          ),
          credentials: {
            trackingId,
            secret: formattedSecret,
          },
        };
      } catch (error) {
        const errCode =
          typeof error === 'object' && error !== null
            ? Reflect.get(error, 'code')
            : undefined;
        const keyPattern =
          typeof error === 'object' && error !== null
            ? Reflect.get(error, 'keyPattern')
            : undefined;
        const isTrackingCollision =
          errCode === 11000 &&
          (!keyPattern ||
            (typeof keyPattern === 'object' &&
              keyPattern !== null &&
              'trackingId' in keyPattern));

        if (isTrackingCollision) {
          if (attempt < 4) {
            continue;
          }
          break;
        }
        throw error;
      }
    }

    throw internalError('Could not allocate a unique tracking ID.');
  } finally {
    if (!persisted) {
      await releaseIncidentDuplicateLock(context.actorId, contentHash).catch(
        () => undefined,
      );
    }
  }
}

const PUBLIC_LIST_SELECT =
  'trackingId title description category incidentAt createdAt location roadName areaName upazila district safetyTip isEdited editedAt moderatedEdit source';
const REDACTED_TEXT_PLACEHOLDER = '[Removed by moderators]';
const HIDDEN_TEXT_PLACEHOLDER = '[Hidden by moderators]';

function parseNumericCsv(raw: string): number[] {
  return raw.split(',').map((segment) => Number(segment.trim()));
}

function isMongoDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

export async function listPublicIncidents(query: ListIncidentsQuery) {
  if (query.sort === 'nearest' && query.cursor !== undefined) {
    throw validationError('cursor is not supported with sort=nearest.');
  }

  const andConditions: Array<Record<string, unknown>> = [{ status: 'published' }];

  if (query.bbox) {
    const [west, south, east, north] = parseNumericCsv(query.bbox) as [
      number,
      number,
      number,
      number,
    ];
    andConditions.push({
      location: {
        $geoWithin: {
          $box: [
            [west, south],
            [east, north],
          ],
        },
      },
    });
  }

  let nearLatLng: [number, number] | null = null;
  if (query.near) {
    const [lat, lng] = parseNumericCsv(query.near) as [number, number];
    nearLatLng = [lat, lng];
    const radiusKm = query.radiusKm ?? SEARCH.DEFAULT_RADIUS_KM;
    andConditions.push({
      location: {
        $geoWithin: {
          $centerSphere: [[lng, lat], radiusKm / 6378.1],
        },
      },
    });
  }

  if (query.q) {
    const normalizedQ = normalizeContentText(query.q);
    if (normalizedQ.length > 0) {
      andConditions.push({
        $text: { $search: normalizedQ },
      });
    }
  }

  if (query.category) {
    const categories = query.category
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean) as IncidentCategory[];
    if (categories.length === 1) {
      andConditions.push({ category: categories[0] });
    } else if (categories.length > 1) {
      andConditions.push({ category: { $in: categories } });
    }
  }

  if (query.from || query.to) {
    const createdAtRange: Record<string, Date> = {};
    if (query.from) {
      createdAtRange.$gte = new Date(query.from);
    }
    if (query.to) {
      createdAtRange.$lte = new Date(query.to);
    }
    andConditions.push({ createdAt: createdAtRange });
  }

  if (query.district) {
    const normalizedDistrict = normalizeContentText(query.district);
    if (normalizedDistrict.length > 0) {
      andConditions.push({
        district: { $regex: `^${escapeRegex(normalizedDistrict)}$`, $options: 'i' },
      });
    }
  }

  if (query.sort === 'nearest' && nearLatLng) {
    const requestedLimit = query.limit ?? PAGING.DEFAULT;
    const effectiveLimit = Math.min(requestedLimit, PAGING.NEAREST_MAX);
    const filter =
      andConditions.length === 1 ? andConditions[0]! : { $and: andConditions };

    // PRD §9.8: compute app-level true haversine distance across matching radius results before slicing <= 100
    const candidates = (await IncidentModel.find(filter)
      .select(PUBLIC_LIST_SELECT)
      .lean()) as IncidentLean[];

    const [nLat, nLng] = nearLatLng;
    const withDistance = candidates
      .map((doc) => {
        const coords = toCoordinatesObject(doc.location);
        const distanceKm = haversineDistanceKm(nLat, nLng, coords.lat, coords.lng);
        return { doc, distanceKm };
      })
      .sort(
        (a, b) =>
          a.distanceKm - b.distanceKm ||
          b.doc.createdAt.getTime() - a.doc.createdAt.getTime() ||
          b.doc._id.toString().localeCompare(a.doc._id.toString()),
      )
      .slice(0, effectiveLimit);

    const incidentCounts = await computeIncidentCountsByIncidentId(
      withDistance.map((entry) => entry.doc._id),
    );

    return {
      items: withDistance.map(({ doc, distanceKm }) =>
        formatPublicIncidentListItem(
          doc,
          incidentCounts.get(doc._id.toString()) ?? {
            support: 0,
            dispute: 0,
            flags: 0,
            comments: 0,
          },
          distanceKm,
        ),
      ),
      nextCursor: null,
      truncated: false,
    };
  }

  const defaultLimit = query.bbox ? PAGING.MAP_MAX : PAGING.DEFAULT;
  const maxLimit = query.bbox ? PAGING.MAP_MAX : PAGING.DEFAULT;
  const effectiveLimit = Math.min(query.limit ?? defaultLimit, maxLimit);
  const sortDir = query.sort === 'oldest' ? 1 : -1;

  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    const cmp = sortDir === -1 ? '$lt' : '$gt';
    andConditions.push({
      $or: [
        { createdAt: { [cmp]: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { [cmp]: cursor.id } },
      ],
    });
  }

  const filter =
    andConditions.length === 1 ? andConditions[0]! : { $and: andConditions };

  const docs = (await IncidentModel.find(filter)
    .select(PUBLIC_LIST_SELECT)
    .sort({ createdAt: sortDir, _id: sortDir })
    .limit(effectiveLimit + 1)
    .lean()) as IncidentLean[];

  const hasMore = docs.length > effectiveLimit;
  const pageDocs = hasMore ? docs.slice(0, effectiveLimit) : docs;
  const lastDoc = pageDocs[pageDocs.length - 1];

  const incidentCounts = await computeIncidentCountsByIncidentId(
    pageDocs.map((doc) => doc._id),
  );

  return {
    items: pageDocs.map((doc) =>
      formatPublicIncidentListItem(
        doc,
        incidentCounts.get(doc._id.toString()) ?? {
          support: 0,
          dispute: 0,
          flags: 0,
          comments: 0,
        },
      ),
    ),
    nextCursor:
      hasMore && lastDoc ? encodeCursor(lastDoc.createdAt, lastDoc._id) : null,
    truncated: Boolean(query.bbox && hasMore),
  };
}

export async function getPublicIncidentByTrackingId(
  trackingId: string,
  callerActorId?: string,
) {
  const doc = (await IncidentModel.findOne({
    trackingId,
    status: 'published',
  })
    .select('-secretHash -actorId -contentHash')
    .lean()) as IncidentLean | null;

  if (!doc) {
    throw notFoundError('Incident was not found.');
  }

  const [counts, myVote, myFlagged] = await Promise.all([
    getIncidentCounts(doc._id),
    callerActorId
      ? VoteModel.findOne({
          incidentId: doc._id,
          actorId: callerActorId,
        })
          .select('type')
          .lean()
      : Promise.resolve(null),
    callerActorId
      ? ReportModel.exists({
          targetType: 'incident',
          targetId: doc._id,
          actorId: callerActorId,
        })
      : Promise.resolve(null),
  ]);

  return formatPublicIncidentDetail(doc, counts, {
    vote: myVote?.type ?? null,
    flagged: Boolean(myFlagged),
  });
}

async function verifyTrackCredentialsOrLock(
  trackingId: string,
  secret: string,
  context: { actorId?: string; ipHash?: string },
): Promise<IncidentLean> {
  await assertTrackNotLocked(trackingId);

  const incident = (await IncidentModel.findOne({ trackingId })
    .select('+secretHash')
    .lean()) as IncidentLean | null;

  const isValid =
    incident !== null &&
    typeof incident.secretHash === 'string' &&
    verifyReporterSecret(secret, incident.secretHash);

  if (!isValid || !incident) {
    const failState = await recordTrackFailure(trackingId);
    if (failState.lockedNow) {
      await recordAbuseSignal({
        ipHash: context.ipHash,
        actorId: context.actorId,
        type: 'track_lockout',
      });
      throw lockedError('Too many failed tracking attempts. Try again later.', {
        retryAfterSeconds: failState.retryAfterSeconds ?? RATE.TRACK_LOCK_MINUTES * 60,
      });
    }
    throw unauthorizedError('Invalid tracking ID or secret.');
  }

  await clearTrackFailures(trackingId);

  const sanitized: IncidentLean = { ...incident };
  delete sanitized.secretHash;
  delete (sanitized as { actorId?: string }).actorId;
  delete (sanitized as { contentHash?: string }).contentHash;
  return sanitized;
}

function buildEditEligibility(incident: IncidentLean, now: Date) {
  const deadline = addMinutes(incident.createdAt, EDIT.WINDOW_MINUTES);
  const remainingMs = Math.max(0, deadline.getTime() - now.getTime());
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const editsLeft = Math.max(0, EDIT.MAX_EDITS - incident.editCount);
  const reporterEditable =
    incident.status === 'published' && !incident.moderatedEdit;
  const allowed = reporterEditable && remainingMs > 0 && editsLeft > 0;

  return {
    allowed,
    remainingSeconds: reporterEditable ? remainingSeconds : 0,
    editsLeft: reporterEditable ? editsLeft : 0,
  };
}

interface TrackVersionLean {
  version: number;
  title: string;
  description: string;
  safetyTip?: string;
  editedAt: Date;
  editedBy: 'reporter' | 'moderator';
  reason?: string;
}

function sanitizeTrackIncident(doc: IncidentLean): IncidentLean {
  const sanitized: IncidentLean = { ...doc };
  delete sanitized.secretHash;
  delete (sanitized as { actorId?: string }).actorId;
  delete (sanitized as { contentHash?: string }).contentHash;
  delete sanitized.hiddenAt;
  delete sanitized.deletedAt;
  delete sanitized.purgeAt;

  if (sanitized.status !== 'published') {
    const placeholder =
      sanitized.status === 'hidden'
        ? HIDDEN_TEXT_PLACEHOLDER
        : REDACTED_TEXT_PLACEHOLDER;
    sanitized.title = placeholder;
    sanitized.description = placeholder;
    delete sanitized.safetyTip;
  }

  return sanitized;
}

function sanitizeTrackVersions(
  versions: TrackVersionLean[],
  status: IncidentLean['status'],
) {
  let highestModeratorVersion: number | null = null;
  for (const entry of versions) {
    if (entry.editedBy === 'moderator') {
      highestModeratorVersion =
        highestModeratorVersion === null
          ? entry.version
          : Math.max(highestModeratorVersion, entry.version);
    }
  }

  return versions.map((v) => {
    const redactOriginalContent =
      status !== 'published' ||
      v.editedBy === 'moderator' ||
      (highestModeratorVersion !== null && v.version <= highestModeratorVersion);

    return {
      version: v.version,
      title: redactOriginalContent ? REDACTED_TEXT_PLACEHOLDER : v.title,
      description: redactOriginalContent ? REDACTED_TEXT_PLACEHOLDER : v.description,
      safetyTip: redactOriginalContent ? null : (v.safetyTip ?? null),
      editedAt: v.editedAt.toISOString(),
      editedBy: v.editedBy,
      reason: null,
    };
  });
}

function buildTrackResponse(
  incident: IncidentLean,
  counts: { support: number; dispute: number; flags: number; comments: number },
  versions: TrackVersionLean[],
  now: Date,
) {
  const sanitizedIncident = sanitizeTrackIncident(incident);
  return {
    incident: formatPublicIncidentDetail(sanitizedIncident, counts, {
      vote: null,
      flagged: false,
    }),
    status: incident.status,
    outcome:
      incident.status === 'published'
        ? null
        : incident.moderationOutcome ?? 'content_rule',
    versions: sanitizeTrackVersions(versions, incident.status),
    edit: buildEditEligibility(incident, now),
  };
}

export async function trackIncidentByCredentials(
  trackingId: string,
  secret: string,
  context: { actorId?: string; ipHash?: string },
) {
  const incident = await verifyTrackCredentialsOrLock(trackingId, secret, context);
  const now = new Date();

  const [counts, versions] = await Promise.all([
    getIncidentCounts(incident._id),
    IncidentVersionModel.find({ incidentId: incident._id })
      .sort({ version: 1 })
      .lean(),
  ]);

  return buildTrackResponse(incident, counts, versions as TrackVersionLean[], now);
}

export async function quickEditIncident(
  trackingId: string,
  input: QuickEditInput,
  context: { actorId?: string; ipHash?: string },
) {
  const incident = await verifyTrackCredentialsOrLock(
    trackingId,
    input.secret,
    context,
  );
  const now = new Date();

  if (incident.status !== 'published') {
    throw forbiddenError('Hidden or removed incidents cannot be edited.');
  }

  if (incident.moderatedEdit) {
    throw forbiddenError(
      'Incidents edited by moderators cannot be modified via quick edit.',
    );
  }

  const deadline = addMinutes(incident.createdAt, EDIT.WINDOW_MINUTES);
  if (now.getTime() > deadline.getTime()) {
    throw editWindowClosedError();
  }

  if (incident.editCount >= EDIT.MAX_EDITS) {
    throw editLimitReachedError();
  }

  const nextTitle =
    input.title !== undefined ? normalizeContentText(input.title) : incident.title;
  const nextDescription =
    input.description !== undefined
      ? normalizeContentText(input.description)
      : incident.description;
  const nextSafetyTip =
    input.safetyTip === undefined
      ? incident.safetyTip
      : input.safetyTip === null
        ? undefined
        : normalizeOptionalContentText(input.safetyTip);

  if (
    nextTitle.length < LIMITS.TITLE.min ||
    nextTitle.length > LIMITS.TITLE.max
  ) {
    throw validationError('Incident title length is invalid.', {
      fields: [{ path: 'title', message: 'Title length is out of range.' }],
    });
  }
  if (
    nextDescription.length < LIMITS.DESCRIPTION.min ||
    nextDescription.length > LIMITS.DESCRIPTION.max
  ) {
    throw validationError('Incident description length is invalid.', {
      fields: [
        { path: 'description', message: 'Description length is out of range.' },
      ],
    });
  }
  if (nextSafetyTip && nextSafetyTip.length > LIMITS.SAFETY_TIP_MAX) {
    throw validationError('Safety tip exceeds maximum length.', {
      fields: [{ path: 'safetyTip', message: 'Safety tip is too long.' }],
    });
  }

  assertNoContactInfo({
    ...(input.title !== undefined ? { title: nextTitle } : {}),
    ...(input.description !== undefined
      ? { description: nextDescription }
      : {}),
    ...(input.safetyTip !== undefined && nextSafetyTip !== undefined
      ? { safetyTip: nextSafetyTip }
      : {}),
  });

  const oversizedFields: string[] = [];
  if (
    input.title !== undefined &&
    computeChangeRatio(incident.title, nextTitle) > EDIT.MAX_CHANGE_RATIO
  ) {
    oversizedFields.push('title');
  }
  if (
    input.description !== undefined &&
    computeChangeRatio(incident.description, nextDescription) >
      EDIT.MAX_CHANGE_RATIO
  ) {
    oversizedFields.push('description');
  }
  if (
    input.safetyTip !== undefined &&
    computeChangeRatio(incident.safetyTip ?? '', nextSafetyTip ?? '') >
      EDIT.MAX_CHANGE_RATIO
  ) {
    oversizedFields.push('safetyTip');
  }

  if (oversizedFields.length > 0) {
    throw validationError('Quick edit change exceeds the allowed 30% difference limit.', {
      reason: 'CHANGE_TOO_LARGE',
      fields: oversizedFields.map((path) => ({
        path,
        message: 'Change exceeds 30% of the previous value.',
      })),
    });
  }

  // Transaction-free sequence (PRD §9.6): snapshot previous state first, then update conditionally
  const versionNumber = incident.editCount + 1;
  try {
    await IncidentVersionModel.create({
      incidentId: incident._id,
      version: versionNumber,
      title: incident.title,
      description: incident.description,
      ...(incident.safetyTip ? { safetyTip: incident.safetyTip } : {}),
      editedAt: now,
      editedBy: 'reporter',
    });
  } catch (error) {
    if (isMongoDuplicateKeyError(error)) {
      throw duplicateActionError(
        'Incident was updated concurrently. Please reload and retry.',
      );
    }
    throw error;
  }

  const nextContentHash = computeIncidentContentHash({
    title: nextTitle,
    description: nextDescription,
  });

  const updateSet: Record<string, unknown> = {
    title: nextTitle,
    description: nextDescription,
    isEdited: true,
    editedAt: now,
    contentHash: nextContentHash,
  };
  const updateUnset: Record<string, 1> = {};

  if (nextSafetyTip !== undefined) {
    updateSet.safetyTip = nextSafetyTip;
  } else if (input.safetyTip !== undefined) {
    updateUnset.safetyTip = 1;
  }

  const updated = (await IncidentModel.findOneAndUpdate(
    {
      _id: incident._id,
      editCount: incident.editCount,
      status: 'published',
      moderatedEdit: false,
    },
    {
      $set: updateSet,
      ...(Object.keys(updateUnset).length > 0 ? { $unset: updateUnset } : {}),
      $inc: { editCount: 1 },
    },
    { new: true },
  )
    .select('-secretHash -actorId -contentHash')
    .lean()) as IncidentLean | null;

  if (!updated) {
    await IncidentVersionModel.deleteOne({
      incidentId: incident._id,
      version: versionNumber,
      editedBy: 'reporter',
    }).catch(() => undefined);
    throw duplicateActionError('Incident was updated concurrently. Please reload and retry.');
  }

  const [counts, versions] = await Promise.all([
    getIncidentCounts(updated._id),
    IncidentVersionModel.find({ incidentId: updated._id })
      .sort({ version: 1 })
      .lean(),
  ]);

  return buildTrackResponse(updated, counts, versions as TrackVersionLean[], now);
}

