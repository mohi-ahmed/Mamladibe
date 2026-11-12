import { Types } from 'mongoose';
import {
  LIMITS,
  MODERATION_OUTCOMES,
  RETENTION,
} from '../constants/index.js';
import { decodeCursor, encodeCursor } from '../lib/cursor.js';
import { addDays, getDhakaDayKey } from '../lib/dhaka-time.js';
import { computeIncidentContentHash, createExcerpt, normalizeContentText, normalizeOptionalContentText } from '../lib/text-rules.js';
import { generateTrackingId } from '../lib/tracking.js';
import {
  ActorModel,
  AdminUserModel,
  AuditLogModel,
  CommentModel,
  IncidentModel,
  IncidentVersionModel,
  ReportModel,
  VoteModel,
} from '../models/index.js';
import type {
  AdminRole,
  IIncident,
  IncidentCategory,
  ModerationOutcome,
} from '../types/index.js';
import {
  internalError,
  notFoundError,
  validationError,
} from '../utils/errors.js';
import { isWithinBangladeshBounds, roundCoordinate } from '../utils/geo.js';
import type {
  AdminCreateIncidentBody,
  AdminEditIncidentBody,
  AdminListIncidentsQuery,
} from '../validators/admin.validator.js';
import { writeAuditLog } from './admin-audit.service.js';
import { getIncidentCounts } from './incident.service.js';

type IncidentLean = IIncident & { _id: Types.ObjectId };

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function findIncidentByIdOrTrackingId(
  idOrTrackingId: string,
): Promise<IncidentLean> {
  const query = /^[0-9a-fA-F]{24}$/.test(idOrTrackingId)
    ? { _id: new Types.ObjectId(idOrTrackingId) }
    : { trackingId: idOrTrackingId.trim().toUpperCase() };

  const doc = (await IncidentModel.findOne(query).lean()) as IncidentLean | null;
  if (!doc) {
    throw notFoundError('Incident was not found.');
  }
  return doc;
}

function formatAdminIncidentSummary(doc: IncidentLean) {
  const [lng, lat] = doc.location.coordinates;
  return {
    id: doc._id.toString(),
    trackingId: doc.trackingId,
    title: doc.title,
    excerpt: createExcerpt(doc.description, LIMITS.EXCERPT_MAX_CHARS),
    category: doc.category,
    status: doc.status,
    source: doc.source,
    actorIdShort: doc.actorId ? doc.actorId.slice(0, 8) : null,
    areaName: doc.areaName ?? null,
    district: doc.district ?? null,
    location: { lat, lng },
    incidentAt: doc.incidentAt.toISOString(),
    createdAt: doc.createdAt.toISOString(),
    isEdited: doc.isEdited,
    editCount: doc.editCount,
    moderatedEdit: doc.moderatedEdit,
    moderationOutcome: doc.moderationOutcome ?? null,
    hiddenAt: doc.hiddenAt ? doc.hiddenAt.toISOString() : null,
    deletedAt: doc.deletedAt ? doc.deletedAt.toISOString() : null,
    purgeAt: doc.purgeAt ? doc.purgeAt.toISOString() : null,
  };
}

export async function getDashboardSummary(caller: {
  adminId: Types.ObjectId;
  role: AdminRole;
}) {
  const now = new Date();
  const dhakaDay = getDhakaDayKey(now);
  const dhakaStart = new Date(`${dhakaDay}T00:00:00.000+06:00`);

  const [
    newIncidentsToday,
    openFlags,
    hiddenIncidents,
    activeRestrictions,
    commentsToday,
    recentAuditDocs,
  ] = await Promise.all([
    IncidentModel.countDocuments({ createdAt: { $gte: dhakaStart } }),
    ReportModel.countDocuments({ status: 'open' }),
    IncidentModel.countDocuments({ status: 'hidden' }),
    ActorModel.countDocuments({ 'restriction.until': { $gt: now } }),
    CommentModel.countDocuments({ createdAt: { $gte: dhakaStart } }),
    AuditLogModel.find(
      caller.role === 'super' ? {} : { adminId: caller.adminId },
    )
      .sort({ createdAt: -1, _id: -1 })
      .limit(10)
      .lean(),
  ]);

  const adminIds = Array.from(
    new Set(recentAuditDocs.map((entry) => entry.adminId.toString())),
  ).map((id) => new Types.ObjectId(id));

  const adminUsers =
    adminIds.length > 0
      ? await AdminUserModel.find({ _id: { $in: adminIds } })
          .select('email role')
          .lean()
      : [];
  const adminMap = new Map(
    adminUsers.map((u) => [u._id.toString(), { email: u.email, role: u.role }]),
  );

  return {
    counts: {
      newIncidentsToday,
      openFlags,
      hiddenIncidents,
      activeRestrictions,
      commentsToday,
    },
    recentAudit: recentAuditDocs.map((entry) => {
      const adminInfo = adminMap.get(entry.adminId.toString());
      return {
        id: entry._id.toString(),
        adminId: entry.adminId.toString(),
        adminEmail: adminInfo?.email ?? null,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ? entry.targetId.toString() : null,
        reason: entry.reason ?? null,
        createdAt: entry.createdAt.toISOString(),
      };
    }),
  };
}

export async function listAdminIncidents(query: AdminListIncidentsQuery) {
  const andConditions: Array<Record<string, unknown>> = [];

  if (query.status) andConditions.push({ status: query.status });
  if (query.category) andConditions.push({ category: query.category });
  if (query.source) andConditions.push({ source: query.source });
  if (query.district) {
    andConditions.push({
      district: new RegExp(`^${escapeRegex(query.district)}$`, 'i'),
    });
  }
  if (query.trackingId) {
    andConditions.push({
      trackingId: query.trackingId.trim().toUpperCase(),
    });
  }
  if (query.actorId) {
    andConditions.push({
      actorId: new RegExp(`^${escapeRegex(query.actorId.toLowerCase())}`),
    });
  }
  if (query.from || query.to) {
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = new Date(query.from);
    if (query.to) range.$lte = new Date(query.to);
    andConditions.push({ createdAt: range });
  }
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    andConditions.push({
      $or: [
        { createdAt: { $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
      ],
    });
  }

  const filter =
    andConditions.length === 0
      ? {}
      : andConditions.length === 1
        ? andConditions[0]!
        : { $and: andConditions };

  const docs = (await IncidentModel.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(query.limit + 1)
    .lean()) as IncidentLean[];

  const hasMore = docs.length > query.limit;
  const pageDocs = hasMore ? docs.slice(0, query.limit) : docs;
  const lastDoc = pageDocs[pageDocs.length - 1];

  return {
    items: pageDocs.map(formatAdminIncidentSummary),
    nextCursor:
      hasMore && lastDoc ? encodeCursor(lastDoc.createdAt, lastDoc._id) : null,
  };
}

export async function getAdminIncidentDetail(
  idOrTrackingId: string,
  caller: { adminId: Types.ObjectId; role: AdminRole },
) {
  const incident = await findIncidentByIdOrTrackingId(idOrTrackingId);

  const [counts, versions, comments, flags, auditHistory] = await Promise.all([
    getIncidentCounts(incident._id),
    IncidentVersionModel.find({ incidentId: incident._id })
      .sort({ version: 1 })
      .lean(),
    CommentModel.find({ incidentId: incident._id })
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)
      .lean(),
    ReportModel.find({ targetType: 'incident', targetId: incident._id })
      .sort({ createdAt: 1 })
      .lean(),
    AuditLogModel.find(
      caller.role === 'super'
        ? { targetType: 'incident', targetId: incident._id }
        : {
            targetType: 'incident',
            targetId: incident._id,
            adminId: caller.adminId,
          },
    )
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
  ]);

  const [lng, lat] = incident.location.coordinates;
  return {
    incident: {
      id: incident._id.toString(),
      trackingId: incident.trackingId,
      title: incident.title,
      description: incident.description,
      category: incident.category,
      status: incident.status,
      source: incident.source,
      actorIdShort: incident.actorId ? incident.actorId.slice(0, 8) : null,
      location: { lat, lng },
      roadName: incident.roadName ?? null,
      areaName: incident.areaName ?? null,
      upazila: incident.upazila ?? null,
      district: incident.district ?? null,
      safetyTip: incident.safetyTip ?? null,
      incidentAt: incident.incidentAt.toISOString(),
      createdAt: incident.createdAt.toISOString(),
      isEdited: incident.isEdited,
      editedAt: incident.editedAt ? incident.editedAt.toISOString() : null,
      editCount: incident.editCount,
      moderatedEdit: incident.moderatedEdit,
      moderationOutcome: incident.moderationOutcome ?? null,
      hiddenAt: incident.hiddenAt ? incident.hiddenAt.toISOString() : null,
      deletedAt: incident.deletedAt ? incident.deletedAt.toISOString() : null,
      purgeAt: incident.purgeAt ? incident.purgeAt.toISOString() : null,
      counts,
    },
    versions: versions.map((v) => ({
      version: v.version,
      title: v.title,
      description: v.description,
      safetyTip: v.safetyTip ?? null,
      editedAt: v.editedAt.toISOString(),
      editedBy: v.editedBy,
      reason: v.reason ?? null,
    })),
    comments: comments.map((c) => ({
      id: c._id.toString(),
      actorIdShort: c.actorId.slice(0, 8),
      type: c.type,
      body: c.body,
      status: c.status,
      redacted: c.redacted,
      createdAt: c.createdAt.toISOString(),
    })),
    flags: flags.map((f) => ({
      id: f._id.toString(),
      actorIdShort: f.actorId.slice(0, 8),
      reason: f.reason,
      note: f.note ?? null,
      status: f.status,
      resolutionNote: f.resolutionNote ?? null,
      createdAt: f.createdAt.toISOString(),
    })),
    auditHistory: auditHistory.map((a) => ({
      id: a._id.toString(),
      adminId: a.adminId.toString(),
      action: a.action,
      reason: a.reason ?? null,
      before: a.before ?? null,
      after: a.after ?? null,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

export async function createTeamIncident(
  input: AdminCreateIncidentBody,
  adminId: Types.ObjectId,
) {
  const title = normalizeContentText(input.title);
  const description = normalizeContentText(input.description);
  const safetyTip = normalizeOptionalContentText(input.safetyTip);
  const roadName = normalizeOptionalContentText(input.roadName);
  const areaName = normalizeOptionalContentText(input.areaName);
  const upazila = normalizeOptionalContentText(input.upazila);
  const district = normalizeOptionalContentText(input.district);

  const now = new Date();
  const incidentAt = new Date(input.incidentAt);
  const oldestAllowedMs =
    now.getTime() - LIMITS.INCIDENT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  if (
    Number.isNaN(incidentAt.getTime()) ||
    incidentAt.getTime() > now.getTime() ||
    incidentAt.getTime() < oldestAllowedMs
  ) {
    throw validationError('Incident time must be within the past 90 days.');
  }

  const roundedCoords: [number, number] = [
    roundCoordinate(input.location.lng),
    roundCoordinate(input.location.lat),
  ];
  if (!isWithinBangladeshBounds(roundedCoords)) {
    throw validationError('Coordinates must lie within Bangladesh bounds.');
  }

  const contentHash = computeIncidentContentHash({ title, description });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const trackingId = generateTrackingId();
    try {
      const created = await IncidentModel.create({
        trackingId,
        title,
        description,
        category: input.category,
        incidentAt,
        location: { type: 'Point', coordinates: roundedCoords },
        ...(roadName ? { roadName } : {}),
        ...(areaName ? { areaName } : {}),
        ...(upazila ? { upazila } : {}),
        ...(district ? { district } : {}),
        ...(safetyTip ? { safetyTip } : {}),
        status: 'published',
        isEdited: false,
        editCount: 0,
        moderatedEdit: false,
        source: 'team',
        contentHash,
        createdAt: now,
      });

      await writeAuditLog({
        adminId,
        action: 'incident.create',
        targetType: 'incident',
        targetId: created._id,
        reason: input.reason ?? 'Official team post',
        after: { trackingId, source: 'team', category: input.category },
        createdAt: now,
      });

      return formatAdminIncidentSummary(created.toObject() as IncidentLean);
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null
          ? Reflect.get(error, 'code')
          : undefined;
      if (code === 11000 && attempt < 4) {
        continue;
      }
      throw error;
    }
  }

  throw internalError('Failed to allocate tracking ID for team post.');
}

export async function moderationEditIncident(
  idOrTrackingId: string,
  input: AdminEditIncidentBody,
  adminId: Types.ObjectId,
) {
  const incident = await findIncidentByIdOrTrackingId(idOrTrackingId);
  const now = new Date();

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
  const nextCategory: IncidentCategory = input.category ?? incident.category;

  const latestVersion = await IncidentVersionModel.findOne({
    incidentId: incident._id,
  })
    .sort({ version: -1 })
    .select('version')
    .lean();

  const nextVersionNum = (latestVersion?.version ?? incident.editCount) + 1;

  await IncidentVersionModel.create({
    incidentId: incident._id,
    version: nextVersionNum,
    title: incident.title,
    description: incident.description,
    ...(incident.safetyTip ? { safetyTip: incident.safetyTip } : {}),
    editedAt: now,
    editedBy: 'moderator',
    reason: input.reason,
  });

  const updateSet: Record<string, unknown> = {
    title: nextTitle,
    description: nextDescription,
    category: nextCategory,
    isEdited: true,
    editedAt: now,
    moderatedEdit: true,
    contentHash: computeIncidentContentHash({
      title: nextTitle,
      description: nextDescription,
    }),
    ...(input.outcome ? { moderationOutcome: input.outcome } : {}),
  };
  const updateUnset: Record<string, 1> = {};
  if (nextSafetyTip !== undefined) {
    updateSet.safetyTip = nextSafetyTip;
  } else if (input.safetyTip !== undefined) {
    updateUnset.safetyTip = 1;
  }

  const updated = (await IncidentModel.findOneAndUpdate(
    { _id: incident._id },
    {
      $set: updateSet,
      ...(Object.keys(updateUnset).length > 0 ? { $unset: updateUnset } : {}),
    },
    { new: true },
  ).lean()) as IncidentLean | null;

  if (!updated) {
    throw notFoundError('Incident was not found.');
  }

  await writeAuditLog({
    adminId,
    action: 'incident.edit',
    targetType: 'incident',
    targetId: incident._id,
    reason: input.reason,
    before: {
      title: incident.title,
      category: incident.category,
      moderatedEdit: incident.moderatedEdit,
    },
    after: {
      title: nextTitle,
      category: nextCategory,
      moderatedEdit: true,
      ...(input.outcome ? { moderationOutcome: input.outcome } : {}),
    },
    createdAt: now,
  });

  return formatAdminIncidentSummary(updated);
}

export async function changeIncidentVisibility(
  idOrTrackingId: string,
  operation: 'hide' | 'unhide' | 'restore' | 'delete',
  input: { reason: string; outcome?: ModerationOutcome },
  adminId: Types.ObjectId,
) {
  const incident = await findIncidentByIdOrTrackingId(idOrTrackingId);
  const now = new Date();

  const updateSet: Record<string, unknown> = {};
  const updateUnset: Record<string, 1> = {};
  let auditAction: string;

  switch (operation) {
    case 'hide': {
      updateSet.status = 'hidden';
      updateSet.hiddenAt = now;
      updateSet.moderationOutcome =
        input.outcome ?? incident.moderationOutcome ?? MODERATION_OUTCOMES[0];
      updateUnset.deletedAt = 1;
      updateUnset.purgeAt = 1;
      auditAction = 'incident.hide';
      break;
    }
    case 'unhide': {
      updateSet.status = 'published';
      updateUnset.hiddenAt = 1;
      updateUnset.purgeAt = 1;
      updateUnset.moderationOutcome = 1;
      auditAction = 'incident.unhide';
      break;
    }
    case 'restore': {
      updateSet.status = 'published';
      updateUnset.hiddenAt = 1;
      updateUnset.deletedAt = 1;
      updateUnset.purgeAt = 1;
      updateUnset.moderationOutcome = 1;
      auditAction = 'incident.restore';
      break;
    }
    case 'delete': {
      updateSet.status = 'deleted';
      updateSet.deletedAt = now;
      updateSet.purgeAt = addDays(now, RETENTION.SOFT_DELETE_DAYS);
      updateSet.moderationOutcome =
        input.outcome ?? incident.moderationOutcome ?? MODERATION_OUTCOMES[0];
      auditAction = 'incident.delete';
      break;
    }
  }

  const updated = (await IncidentModel.findOneAndUpdate(
    { _id: incident._id },
    {
      $set: updateSet,
      ...(Object.keys(updateUnset).length > 0 ? { $unset: updateUnset } : {}),
    },
    { new: true },
  ).lean()) as IncidentLean | null;

  if (!updated) {
    throw notFoundError('Incident was not found.');
  }

  await writeAuditLog({
    adminId,
    action: auditAction,
    targetType: 'incident',
    targetId: incident._id,
    reason: input.reason,
    before: { status: incident.status },
    after: {
      status: updated.status,
      ...(updated.moderationOutcome
        ? { moderationOutcome: updated.moderationOutcome }
        : {}),
    },
    createdAt: now,
  });

  return formatAdminIncidentSummary(updated);
}

export async function purgeIncidentPermanently(
  idOrTrackingId: string,
  reason: string,
  adminId: Types.ObjectId,
) {
  const incident = await findIncidentByIdOrTrackingId(idOrTrackingId);

  const commentDocs = await CommentModel.find({ incidentId: incident._id })
    .select('_id')
    .lean();
  const commentIds = commentDocs.map((c) => c._id as Types.ObjectId);

  await Promise.all([
    ReportModel.deleteMany({
      targetType: 'incident',
      targetId: incident._id,
    }),
    ...(commentIds.length > 0
      ? [
          ReportModel.deleteMany({
            targetType: 'comment',
            targetId: { $in: commentIds },
          }),
        ]
      : []),
    VoteModel.deleteMany({ incidentId: incident._id }),
    CommentModel.deleteMany({ incidentId: incident._id }),
    IncidentVersionModel.deleteMany({ incidentId: incident._id }),
    IncidentModel.deleteOne({ _id: incident._id }),
  ]);

  await writeAuditLog({
    adminId,
    action: 'incident.purge',
    targetType: 'incident',
    targetId: incident._id,
    reason,
    before: {
      trackingId: incident.trackingId,
      title: incident.title,
      status: incident.status,
    },
  });

  return {
    purged: true,
    trackingId: incident.trackingId,
    deletedComments: commentIds.length,
  };
}
