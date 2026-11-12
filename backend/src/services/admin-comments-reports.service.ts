import { Types } from 'mongoose';
import { LIMITS, RETENTION } from '../constants/index.js';
import { decodeCursor, encodeCursor } from '../lib/cursor.js';
import { addDays } from '../lib/dhaka-time.js';
import { createExcerpt, normalizeContentText } from '../lib/text-rules.js';
import {
  AuditLogModel,
  CommentModel,
  IncidentModel,
  ReportModel,
} from '../models/index.js';
import type {
  AdminRole,
  IComment,
  IIncident,
  IReport,
} from '../types/index.js';
import { notFoundError, validationError } from '../utils/errors.js';
import type {
  AdminEditCommentBody,
  AdminListCommentsQuery,
  AdminListReportsQuery,
  AdminResolveReportBody,
} from '../validators/admin.validator.js';
import { writeAuditLog } from './admin-audit.service.js';

type CommentLean = IComment & { _id: Types.ObjectId };
type IncidentLean = IIncident & { _id: Types.ObjectId };
type ReportLean = IReport & { _id: Types.ObjectId };

function formatAdminComment(
  doc: CommentLean,
  trackingIdMap?: Map<string, string>,
) {
  return {
    id: doc._id.toString(),
    incidentId: doc.incidentId.toString(),
    trackingId: trackingIdMap?.get(doc.incidentId.toString()) ?? null,
    actorIdShort: doc.actorId.slice(0, 8),
    type: doc.type,
    body: doc.body,
    status: doc.status,
    redacted: doc.redacted,
    createdAt: doc.createdAt.toISOString(),
    hiddenAt: doc.hiddenAt ? doc.hiddenAt.toISOString() : null,
    deletedAt: doc.deletedAt ? doc.deletedAt.toISOString() : null,
    purgeAt: doc.purgeAt ? doc.purgeAt.toISOString() : null,
  };
}

export async function listAdminComments(query: AdminListCommentsQuery) {
  const andConditions: Array<Record<string, unknown>> = [];

  if (query.status) andConditions.push({ status: query.status });
  if (query.type) andConditions.push({ type: query.type });
  if (query.actorId) {
    andConditions.push({
      actorId: new RegExp(`^${query.actorId.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    });
  }
  if (query.incidentId) {
    if (!/^[0-9a-fA-F]{24}$/.test(query.incidentId)) {
      throw validationError('Invalid incidentId format.');
    }
    andConditions.push({ incidentId: new Types.ObjectId(query.incidentId) });
  } else if (query.trackingId) {
    const incident = await IncidentModel.findOne({
      trackingId: query.trackingId.trim().toUpperCase(),
    })
      .select('_id')
      .lean();
    if (!incident) {
      return { items: [], nextCursor: null };
    }
    andConditions.push({ incidentId: incident._id });
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

  const docs = (await CommentModel.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(query.limit + 1)
    .lean()) as CommentLean[];

  const hasMore = docs.length > query.limit;
  const pageDocs = hasMore ? docs.slice(0, query.limit) : docs;
  const lastDoc = pageDocs[pageDocs.length - 1];

  const incidentIds = Array.from(
    new Set(pageDocs.map((c) => c.incidentId.toString())),
  ).map((id) => new Types.ObjectId(id));
  const incidents =
    incidentIds.length > 0
      ? await IncidentModel.find({ _id: { $in: incidentIds } })
          .select('trackingId')
          .lean()
      : [];
  const trackingMap = new Map(
    incidents.map((inc) => [inc._id.toString(), inc.trackingId]),
  );

  return {
    items: pageDocs.map((doc) => formatAdminComment(doc, trackingMap)),
    nextCursor:
      hasMore && lastDoc ? encodeCursor(lastDoc.createdAt, lastDoc._id) : null,
  };
}

export async function getAdminCommentDetail(
  commentIdHex: string,
  caller: { adminId: Types.ObjectId; role: AdminRole },
) {
  const commentId = new Types.ObjectId(commentIdHex);
  const comment = (await CommentModel.findOne({ _id: commentId }).lean()) as
    | CommentLean
    | null;

  if (!comment) {
    throw notFoundError('Comment was not found.');
  }

  const [incident, flags, auditHistory] = await Promise.all([
    IncidentModel.findOne({ _id: comment.incidentId })
      .select('trackingId title status')
      .lean(),
    ReportModel.find({ targetType: 'comment', targetId: comment._id })
      .sort({ createdAt: 1 })
      .lean(),
    AuditLogModel.find(
      caller.role === 'super'
        ? { targetType: 'comment', targetId: comment._id }
        : {
            targetType: 'comment',
            targetId: comment._id,
            adminId: caller.adminId,
          },
    )
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
  ]);

  return {
    comment: formatAdminComment(comment),
    incident: incident
      ? {
          id: incident._id.toString(),
          trackingId: incident.trackingId,
          title: incident.title,
          status: incident.status,
        }
      : null,
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

export async function redactComment(
  commentIdHex: string,
  input: AdminEditCommentBody,
  adminId: Types.ObjectId,
) {
  const commentId = new Types.ObjectId(commentIdHex);
  const existing = (await CommentModel.findOne({ _id: commentId }).lean()) as
    | CommentLean
    | null;
  if (!existing) {
    throw notFoundError('Comment was not found.');
  }

  const nextBody = normalizeContentText(input.body);
  const updated = (await CommentModel.findOneAndUpdate(
    { _id: commentId },
    { $set: { body: nextBody, redacted: true } },
    { new: true },
  ).lean()) as CommentLean | null;

  if (!updated) {
    throw notFoundError('Comment was not found.');
  }

  await writeAuditLog({
    adminId,
    action: 'comment.edit',
    targetType: 'comment',
    targetId: commentId,
    reason: input.reason,
    before: { body: existing.body, redacted: existing.redacted },
    after: { body: nextBody, redacted: true },
  });

  return formatAdminComment(updated);
}

export async function changeCommentVisibility(
  commentIdHex: string,
  operation: 'hide' | 'unhide' | 'delete',
  reason: string,
  adminId: Types.ObjectId,
) {
  const commentId = new Types.ObjectId(commentIdHex);
  const existing = (await CommentModel.findOne({ _id: commentId }).lean()) as
    | CommentLean
    | null;
  if (!existing) {
    throw notFoundError('Comment was not found.');
  }

  const now = new Date();
  const updateSet: Record<string, unknown> = {};
  const updateUnset: Record<string, 1> = {};
  let action: string;

  switch (operation) {
    case 'hide':
      updateSet.status = 'hidden';
      updateSet.hiddenAt = now;
      updateUnset.deletedAt = 1;
      updateUnset.purgeAt = 1;
      action = 'comment.hide';
      break;
    case 'unhide':
      updateSet.status = 'published';
      updateUnset.hiddenAt = 1;
      updateUnset.purgeAt = 1;
      action = 'comment.unhide';
      break;
    case 'delete':
      updateSet.status = 'deleted';
      updateSet.deletedAt = now;
      updateSet.purgeAt = addDays(now, RETENTION.SOFT_DELETE_DAYS);
      action = 'comment.delete';
      break;
  }

  const updated = (await CommentModel.findOneAndUpdate(
    { _id: commentId },
    {
      $set: updateSet,
      ...(Object.keys(updateUnset).length > 0 ? { $unset: updateUnset } : {}),
    },
    { new: true },
  ).lean()) as CommentLean | null;

  if (!updated) {
    throw notFoundError('Comment was not found.');
  }

  await writeAuditLog({
    adminId,
    action,
    targetType: 'comment',
    targetId: commentId,
    reason,
    before: { status: existing.status },
    after: { status: updated.status },
    createdAt: now,
  });

  return formatAdminComment(updated);
}

export async function purgeCommentPermanently(
  commentIdHex: string,
  reason: string,
  adminId: Types.ObjectId,
) {
  const commentId = new Types.ObjectId(commentIdHex);
  const existing = (await CommentModel.findOne({ _id: commentId }).lean()) as
    | CommentLean
    | null;
  if (!existing) {
    throw notFoundError('Comment was not found.');
  }

  await Promise.all([
    ReportModel.deleteMany({ targetType: 'comment', targetId: commentId }),
    CommentModel.deleteOne({ _id: commentId }),
  ]);

  await writeAuditLog({
    adminId,
    action: 'comment.purge',
    targetType: 'comment',
    targetId: commentId,
    reason,
    before: {
      incidentId: existing.incidentId.toString(),
      status: existing.status,
    },
  });

  return { purged: true };
}

async function buildTargetPreviews(reports: ReportLean[]) {
  const incidentTargetIds = Array.from(
    new Set(
      reports
        .filter((r) => r.targetType === 'incident')
        .map((r) => r.targetId.toString()),
    ),
  ).map((id) => new Types.ObjectId(id));

  const commentTargetIds = Array.from(
    new Set(
      reports
        .filter((r) => r.targetType === 'comment')
        .map((r) => r.targetId.toString()),
    ),
  ).map((id) => new Types.ObjectId(id));

  const [incidents, comments, openCountsAgg] = await Promise.all([
    incidentTargetIds.length > 0
      ? (IncidentModel.find({ _id: { $in: incidentTargetIds } })
          .select('trackingId title description category status')
          .lean() as Promise<IncidentLean[]>)
      : Promise.resolve([]),
    commentTargetIds.length > 0
      ? (CommentModel.find({ _id: { $in: commentTargetIds } })
          .select('incidentId body type status')
          .lean() as Promise<CommentLean[]>)
      : Promise.resolve([]),
    reports.length > 0
      ? ReportModel.aggregate<{
          _id: { targetType: string; targetId: Types.ObjectId };
          count: number;
        }>([
          {
            $match: {
              targetId: {
                $in: [...incidentTargetIds, ...commentTargetIds],
              },
            },
          },
          {
            $group: {
              _id: { targetType: '$targetType', targetId: '$targetId' },
              count: { $sum: 1 },
            },
          },
        ])
      : Promise.resolve([]),
  ]);

  const incidentMap = new Map(incidents.map((i) => [i._id.toString(), i]));
  const commentMap = new Map(comments.map((c) => [c._id.toString(), c]));
  const flagCountMap = new Map(
    openCountsAgg.map((row) => [
      `${row._id.targetType}:${row._id.targetId.toString()}`,
      row.count,
    ]),
  );

  const missingParentIds = Array.from(
    new Set(
      comments
        .map((c) => c.incidentId.toString())
        .filter((id) => !incidentMap.has(id)),
    ),
  ).map((id) => new Types.ObjectId(id));

  if (missingParentIds.length > 0) {
    const parentIncidents = await IncidentModel.find({
      _id: { $in: missingParentIds },
    })
      .select('trackingId title status')
      .lean();
    for (const p of parentIncidents) {
      incidentMap.set(p._id.toString(), p as IncidentLean);
    }
  }

  return { incidentMap, commentMap, flagCountMap };
}

export async function listAdminReports(query: AdminListReportsQuery) {
  const andConditions: Array<Record<string, unknown>> = [];
  if (query.status) andConditions.push({ status: query.status });
  if (query.targetType) andConditions.push({ targetType: query.targetType });

  const sortDir = query.sort === 'newest' ? -1 : 1;
  if (query.cursor && query.sort !== 'most_flagged') {
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
    andConditions.length === 0
      ? {}
      : andConditions.length === 1
        ? andConditions[0]!
        : { $and: andConditions };

  const fetchLimit =
    query.sort === 'most_flagged' ? Math.max(query.limit * 3, 150) : query.limit + 1;

  const docs = (await ReportModel.find(filter)
    .sort({ createdAt: sortDir, _id: sortDir })
    .limit(fetchLimit)
    .lean()) as ReportLean[];

  const hasMoreByCursor =
    query.sort !== 'most_flagged' && docs.length > query.limit;
  const workingDocs = hasMoreByCursor ? docs.slice(0, query.limit) : docs;

  const { incidentMap, commentMap, flagCountMap } =
    await buildTargetPreviews(workingDocs);

  let mapped = workingDocs.map((r) => {
    const key = `${r.targetType}:${r.targetId.toString()}`;
    const totalFlagsOnTarget = flagCountMap.get(key) ?? 1;

    let targetPreview: Record<string, unknown> | null = null;
    if (r.targetType === 'incident') {
      const inc = incidentMap.get(r.targetId.toString());
      if (inc) {
        targetPreview = {
          trackingId: inc.trackingId,
          title: inc.title,
          excerpt: createExcerpt(inc.description, LIMITS.EXCERPT_MAX_CHARS),
          category: inc.category,
          status: inc.status,
        };
      }
    } else {
      const comm = commentMap.get(r.targetId.toString());
      if (comm) {
        const parentInc = incidentMap.get(comm.incidentId.toString());
        targetPreview = {
          commentId: comm._id.toString(),
          trackingId: parentInc?.trackingId ?? null,
          type: comm.type,
          excerpt: createExcerpt(comm.body, LIMITS.EXCERPT_MAX_CHARS),
          status: comm.status,
        };
      }
    }

    return {
      id: r._id.toString(),
      targetType: r.targetType,
      targetId: r.targetId.toString(),
      actorIdShort: r.actorId.slice(0, 8),
      reason: r.reason,
      note: r.note ?? null,
      status: r.status,
      resolutionNote: r.resolutionNote ?? null,
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      totalFlagsOnTarget,
      targetPreview,
    };
  });

  if (query.sort === 'most_flagged') {
    mapped = mapped
      .sort((a, b) => {
        if (b.totalFlagsOnTarget !== a.totalFlagsOnTarget) {
          return b.totalFlagsOnTarget - a.totalFlagsOnTarget;
        }
        return a.createdAt.localeCompare(b.createdAt);
      })
      .slice(0, query.limit);
  }

  const lastDoc = workingDocs[workingDocs.length - 1];
  return {
    items: mapped,
    nextCursor:
      hasMoreByCursor && lastDoc
        ? encodeCursor(lastDoc.createdAt, lastDoc._id)
        : null,
  };
}

export async function getAdminReportDetail(reportIdHex: string) {
  const reportId = new Types.ObjectId(reportIdHex);
  const report = (await ReportModel.findOne({ _id: reportId }).lean()) as
    | ReportLean
    | null;
  if (!report) {
    throw notFoundError('Report was not found.');
  }

  const [siblingReports, targetIncident, targetComment] = await Promise.all([
    ReportModel.find({
      targetType: report.targetType,
      targetId: report.targetId,
    })
      .sort({ createdAt: 1 })
      .lean(),
    report.targetType === 'incident'
      ? IncidentModel.findOne({ _id: report.targetId }).lean()
      : Promise.resolve(null),
    report.targetType === 'comment'
      ? CommentModel.findOne({ _id: report.targetId }).lean()
      : Promise.resolve(null),
  ]);

  let commentParentIncident: { trackingId: string; title: string } | null = null;
  if (targetComment) {
    const parent = await IncidentModel.findOne({ _id: targetComment.incidentId })
      .select('trackingId title')
      .lean();
    if (parent) {
      commentParentIncident = {
        trackingId: parent.trackingId,
        title: parent.title,
      };
    }
  }

  return {
    report: {
      id: report._id.toString(),
      targetType: report.targetType,
      targetId: report.targetId.toString(),
      actorIdShort: report.actorId.slice(0, 8),
      reason: report.reason,
      note: report.note ?? null,
      status: report.status,
      resolutionNote: report.resolutionNote ?? null,
      resolvedAt: report.resolvedAt ? report.resolvedAt.toISOString() : null,
      createdAt: report.createdAt.toISOString(),
    },
    target: targetIncident
      ? {
          kind: 'incident' as const,
          id: targetIncident._id.toString(),
          trackingId: targetIncident.trackingId,
          title: targetIncident.title,
          description: targetIncident.description,
          category: targetIncident.category,
          status: targetIncident.status,
          safetyTip: targetIncident.safetyTip ?? null,
        }
      : targetComment
        ? {
            kind: 'comment' as const,
            id: targetComment._id.toString(),
            trackingId: commentParentIncident?.trackingId ?? null,
            incidentTitle: commentParentIncident?.title ?? null,
            type: targetComment.type,
            body: targetComment.body,
            status: targetComment.status,
            redacted: targetComment.redacted,
          }
        : null,
    relatedFlags: siblingReports.map((s) => ({
      id: s._id.toString(),
      actorIdShort: s.actorId.slice(0, 8),
      reason: s.reason,
      note: s.note ?? null,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
    })),
  };
}

export async function resolveAdminReport(
  reportIdHex: string,
  input: AdminResolveReportBody,
  adminId: Types.ObjectId,
) {
  const reportId = new Types.ObjectId(reportIdHex);
  const existing = (await ReportModel.findOne({ _id: reportId }).lean()) as
    | ReportLean
    | null;

  if (!existing) {
    throw notFoundError('Report was not found.');
  }

  const now = new Date();
  const resolutionNote = normalizeContentText(input.note);

  const result = input.resolveAllForTarget
    ? await ReportModel.updateMany(
        {
          targetType: existing.targetType,
          targetId: existing.targetId,
          status: 'open',
        },
        {
          $set: {
            status: input.outcome,
            resolvedBy: adminId,
            resolvedAt: now,
            resolutionNote,
          },
        },
      )
    : await ReportModel.updateOne(
        { _id: reportId },
        {
          $set: {
            status: input.outcome,
            resolvedBy: adminId,
            resolvedAt: now,
            resolutionNote,
          },
        },
      );

  await writeAuditLog({
    adminId,
    action: 'report.resolve',
    targetType: 'report',
    targetId: reportId,
    reason: resolutionNote,
    before: { status: existing.status },
    after: {
      status: input.outcome,
      resolveAllForTarget: Boolean(input.resolveAllForTarget),
      updatedCount: result.modifiedCount ?? 1,
    },
    createdAt: now,
  });

  return {
    resolved: true,
    outcome: input.outcome,
    updatedCount: Math.max(result.modifiedCount ?? 0, 1),
  };
}
