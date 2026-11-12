import { generateSecret } from 'otplib';
import { Types } from 'mongoose';
import { getRequiredEnvSecret } from '../config/env.js';
import { PATTERNS, RATE, SETTING_KEYS } from '../constants/index.js';
import {
  encryptTotpSecret,
  hashAdminPassword,
  validateAdminPasswordStrength,
} from '../lib/crypto.js';
import { decodeCursor, encodeCursor } from '../lib/cursor.js';
import { addDays, getDhakaDayKey } from '../lib/dhaka-time.js';
import { normalizeOptionalContentText } from '../lib/text-rules.js';
import {
  AbuseSignalModel,
  ActorModel,
  AdminSessionModel,
  AdminUserModel,
  AuditLogModel,
  CommentModel,
  DailyQuotaModel,
  IncidentModel,
  ReportModel,
  SettingModel,
  VoteModel,
} from '../models/index.js';
import type {
  AdminRole,
  IActor,
  IAdminUser,
  IAuditLog,
} from '../types/index.js';
import {
  duplicateActionError,
  forbiddenError,
  notFoundError,
  validationError,
} from '../utils/errors.js';
import type {
  AdminCreateUserBody,
  AdminListActorsQuery,
  AdminListAuditQuery,
  AdminRestrictActorBody,
  AdminUpdateSettingsBody,
  AdminUpdateUserBody,
} from '../validators/admin.validator.js';
import { writeAuditLog } from './admin-audit.service.js';
import { getPlatformFreezeState } from './settings.service.js';

type ActorLean = IActor & { _id: Types.ObjectId };
type AdminUserLean = IAdminUser & { _id: Types.ObjectId };
type AuditLogLean = IAuditLog & { _id: Types.ObjectId };

function formatActorSummary(doc: ActorLean, now: Date) {
  const activeRestriction =
    doc.restriction && doc.restriction.until > now ? doc.restriction : null;
  return {
    id: doc._id.toString(),
    actorIdShort: doc.actorId.slice(0, 8),
    firstSeenAt: doc.firstSeenAt.toISOString(),
    lastSeenAt: doc.lastSeenAt.toISOString(),
    restriction: activeRestriction
      ? {
          scope: activeRestriction.scope,
          until: activeRestriction.until.toISOString(),
          reason: activeRestriction.reason,
          setAt: activeRestriction.setAt
            ? activeRestriction.setAt.toISOString()
            : null,
        }
      : null,
    restrictionHistoryCount: doc.restrictionHistory.length,
    notes: doc.notes ?? null,
  };
}

export async function listActors(
  query: AdminListActorsQuery,
  callerAdminId: Types.ObjectId,
) {
  const andConditions: Array<Record<string, unknown>> = [];
  const now = new Date();
  let earlyEmpty = false;

  if (query.restrictedOnly) {
    andConditions.push({ 'restriction.until': { $gt: now } });
  }

  const trimmedSearch = query.q?.trim();
  if (trimmedSearch) {
    const upperSearch = trimmedSearch.toUpperCase();
    if (PATTERNS.TRACKING_ID.test(upperSearch)) {
      await writeAuditLog({
        adminId: callerAdminId,
        action: 'actor.view',
        targetType: 'actor',
        after: {
          searchMode: 'trackingId',
          trackingId: upperSearch,
        },
        createdAt: now,
      });
      const incident = await IncidentModel.findOne({
        trackingId: upperSearch,
      })
        .select('actorId')
        .lean();
      if (!incident?.actorId) {
        earlyEmpty = true;
      } else {
        andConditions.push({ actorId: incident.actorId });
      }
    } else if (/^[0-9a-f]{1,32}$/i.test(trimmedSearch)) {
      const lowerHex = trimmedSearch.toLowerCase();
      await writeAuditLog({
        adminId: callerAdminId,
        action: 'actor.view',
        targetType: 'actor',
        after: {
          searchMode: 'actorIdPrefix',
          queryPrefix: lowerHex.slice(0, 8),
          queryLength: lowerHex.length,
        },
        createdAt: now,
      });
      andConditions.push({
        actorId: new RegExp(`^${lowerHex}`),
      });
    } else {
      // Partial live tracking ID (e.g. "MD-" / "MD-2026") or unsupported text
      await writeAuditLog({
        adminId: callerAdminId,
        action: 'actor.view',
        targetType: 'actor',
        after: {
          searchMode: /^md-/i.test(trimmedSearch) ? 'trackingIdPartial' : 'query',
          queryPrefix: trimmedSearch.slice(0, 8),
        },
        createdAt: now,
      });
      earlyEmpty = true;
    }
  }

  if (earlyEmpty) {
    return { items: [], nextCursor: null };
  }

  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    andConditions.push({
      $or: [
        { lastSeenAt: { $lt: cursor.createdAt } },
        { lastSeenAt: cursor.createdAt, _id: { $lt: cursor.id } },
      ],
    });
  }

  const filter =
    andConditions.length === 0
      ? {}
      : andConditions.length === 1
        ? andConditions[0]!
        : { $and: andConditions };

  const docs = (await ActorModel.find(filter)
    .sort({ lastSeenAt: -1, _id: -1 })
    .limit(query.limit + 1)
    .lean()) as ActorLean[];

  const hasMore = docs.length > query.limit;
  const pageDocs = hasMore ? docs.slice(0, query.limit) : docs;
  const lastDoc = pageDocs[pageDocs.length - 1];

  return {
    items: pageDocs.map((doc) => formatActorSummary(doc, now)),
    nextCursor:
      hasMore && lastDoc ? encodeCursor(lastDoc.lastSeenAt, lastDoc._id) : null,
  };
}

async function resolveActorByIdentifier(
  identifier: string,
  allowPrefixAndTrackingId: boolean,
): Promise<ActorLean> {
  const trimmed = identifier.trim();
  const lower = trimmed.toLowerCase();

  if (PATTERNS.ACTOR_ID_HEX.test(lower)) {
    const actor = (await ActorModel.findOne({ actorId: lower }).lean()) as
      | ActorLean
      | null;
    if (!actor) {
      throw notFoundError('Actor was not found.');
    }
    return actor;
  }

  if (/^[0-9a-f]{24}$/.test(lower)) {
    const byObjectId = (await ActorModel.findOne({
      _id: new Types.ObjectId(lower),
    }).lean()) as ActorLean | null;
    if (byObjectId) {
      return byObjectId;
    }
    if (!allowPrefixAndTrackingId) {
      throw notFoundError('Actor was not found.');
    }
  }

  if (!allowPrefixAndTrackingId) {
    throw validationError('Invalid actor ID format.');
  }

  const upper = trimmed.toUpperCase();
  if (PATTERNS.TRACKING_ID.test(upper)) {
    const incident = await IncidentModel.findOne({ trackingId: upper })
      .select('actorId')
      .lean();
    if (!incident?.actorId) {
      throw notFoundError('Actor was not found.');
    }
    const actor = (await ActorModel.findOne({
      actorId: incident.actorId,
    }).lean()) as ActorLean | null;
    if (!actor) {
      throw notFoundError('Actor was not found.');
    }
    return actor;
  }

  if (/^[0-9a-f]{8,31}$/.test(lower)) {
    const matches = (await ActorModel.find({
      actorId: new RegExp(`^${lower}`),
    })
      .limit(2)
      .lean()) as ActorLean[];
    if (matches.length === 0) {
      throw notFoundError('Actor was not found.');
    }
    if (matches.length > 1) {
      throw validationError(
        'Ambiguous actor prefix. Provide more characters or the record ID.',
      );
    }
    return matches[0]!;
  }

  throw validationError(
    'Invalid actor identifier. Provide an actor ID, 8+ hex prefix, record ID, or tracking ID.',
  );
}

export async function getActorProfile(
  identifier: string,
  callerAdminId: Types.ObjectId,
) {
  const actor = await resolveActorByIdentifier(identifier, true);
  const targetActorId = actor.actorId;

  const now = new Date();
  const dhakaDay = getDhakaDayKey(now);

  const [
    incidents,
    comments,
    voteCount,
    flagsFiledCount,
    todayQuota,
    abuseSignalsAgg,
  ] = await Promise.all([
    IncidentModel.find({ actorId: targetActorId })
      .select('trackingId title category status createdAt')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    CommentModel.find({ actorId: targetActorId })
      .select('incidentId type status createdAt')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    VoteModel.countDocuments({ actorId: targetActorId }),
    ReportModel.countDocuments({ actorId: targetActorId }),
    DailyQuotaModel.findOne({
      actorId: targetActorId,
      day: dhakaDay,
      kind: 'comment',
    })
      .select('count')
      .lean(),
    AbuseSignalModel.aggregate<{ _id: string; count: number }>([
      { $match: { actorId: targetActorId } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
  ]);

  // Mandatory audit logging whenever an admin inspects an actor timeline (PRD §11.3)
  await writeAuditLog({
    adminId: callerAdminId,
    action: 'actor.view',
    targetType: 'actor',
    targetId: actor._id,
    after: { actorIdShort: targetActorId.slice(0, 8) },
    createdAt: now,
  });

  const commentIncidentIds = Array.from(
    new Set(comments.map((c) => c.incidentId.toString())),
  ).map((id) => new Types.ObjectId(id));
  const commentParents =
    commentIncidentIds.length > 0
      ? await IncidentModel.find({ _id: { $in: commentIncidentIds } })
          .select('trackingId')
          .lean()
      : [];
  const parentTrackingMap = new Map(
    commentParents.map((p) => [p._id.toString(), p.trackingId]),
  );

  const signalCounts: Record<string, number> = {};
  for (const row of abuseSignalsAgg) {
    signalCounts[row._id] = row.count;
  }

  return {
    actor: {
      ...formatActorSummary(actor, now),
      restrictionHistory: actor.restrictionHistory.map((r) => ({
        scope: r.scope,
        until: r.until.toISOString(),
        reason: r.reason,
        setAt: r.setAt ? r.setAt.toISOString() : null,
      })),
    },
    activity: {
      incidents: incidents.map((i) => ({
        id: i._id.toString(),
        trackingId: i.trackingId,
        title: i.title,
        category: i.category,
        status: i.status,
        createdAt: i.createdAt.toISOString(),
      })),
      comments: comments.map((c) => ({
        id: c._id.toString(),
        trackingId: parentTrackingMap.get(c.incidentId.toString()) ?? null,
        type: c.type,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      })),
      voteCount,
      flagsFiledCount,
      commentsUsedToday: todayQuota?.count ?? 0,
      commentsDailyLimit: RATE.COMMENTS_PER_ACTOR_PER_DAY,
      abuseSignals: signalCounts,
    },
  };
}

export async function updateActorNotes(
  actorIdOrId: string,
  notes: string | null,
  adminId: Types.ObjectId,
  reason?: string,
) {
  const existing = await resolveActorByIdentifier(actorIdOrId, false);
  const now = new Date();
  const cleaned = notes === null ? undefined : normalizeOptionalContentText(notes);
  const updated = (await ActorModel.findOneAndUpdate(
    { _id: existing._id },
    cleaned !== undefined ? { $set: { notes: cleaned } } : { $unset: { notes: 1 } },
    { new: true },
  ).lean()) as ActorLean | null;

  if (!updated) {
    throw notFoundError('Actor was not found.');
  }

  await writeAuditLog({
    adminId,
    action: 'actor.notes',
    targetType: 'actor',
    targetId: existing._id,
    reason: reason ?? 'Actor moderator notes updated',
    before: { notes: existing.notes ?? null },
    after: {
      actorIdShort: updated.actorId.slice(0, 8),
      notes: updated.notes ?? null,
    },
    createdAt: now,
  });

  return formatActorSummary(updated, now);
}

export async function restrictActor(
  actorIdOrId: string,
  input: AdminRestrictActorBody,
  adminId: Types.ObjectId,
) {
  const existing = await resolveActorByIdentifier(actorIdOrId, false);

  const now = new Date();
  const until = addDays(now, input.days);
  const restrictionEntry = {
    scope: [...new Set(input.scope)],
    until,
    reason: input.reason,
    setBy: adminId,
    setAt: now,
  };

  const updated = (await ActorModel.findOneAndUpdate(
    { _id: existing._id },
    {
      $set: { restriction: restrictionEntry },
      $push: { restrictionHistory: restrictionEntry },
    },
    { new: true },
  ).lean()) as ActorLean | null;

  if (!updated) {
    throw notFoundError('Actor was not found.');
  }

  await writeAuditLog({
    adminId,
    action: 'actor.restrict',
    targetType: 'actor',
    targetId: existing._id,
    reason: input.reason,
    after: {
      actorIdShort: existing.actorId.slice(0, 8),
      scope: restrictionEntry.scope,
      until: until.toISOString(),
    },
    createdAt: now,
  });

  return formatActorSummary(updated, now);
}

export async function unrestrictActor(
  actorIdOrId: string,
  reason: string,
  adminId: Types.ObjectId,
) {
  const existing = await resolveActorByIdentifier(actorIdOrId, false);

  const now = new Date();
  const updated = (await ActorModel.findOneAndUpdate(
    { _id: existing._id },
    { $unset: { restriction: 1 } },
    { new: true },
  ).lean()) as ActorLean | null;

  if (!updated) {
    throw notFoundError('Actor was not found.');
  }

  await writeAuditLog({
    adminId,
    action: 'actor.unrestrict',
    targetType: 'actor',
    targetId: existing._id,
    reason,
    before: existing.restriction
      ? {
          scope: existing.restriction.scope,
          until: existing.restriction.until.toISOString(),
        }
      : undefined,
    after: { actorIdShort: existing.actorId.slice(0, 8), restriction: null },
    createdAt: now,
  });

  return formatActorSummary(updated, now);
}

function formatAdminUserPublic(doc: AdminUserLean) {
  return {
    id: doc._id.toString(),
    email: doc.email,
    role: doc.role,
    totpEnabled: doc.totpEnabled,
    active: doc.active,
    createdAt: doc.createdAt.toISOString(),
    lastLoginAt: doc.lastLoginAt ? doc.lastLoginAt.toISOString() : null,
  };
}

export async function listAdminUsers() {
  const users = (await AdminUserModel.find({})
    .sort({ createdAt: 1 })
    .lean()) as AdminUserLean[];
  return { items: users.map(formatAdminUserPublic) };
}

export async function createAdminUser(
  input: AdminCreateUserBody,
  callerAdminId: Types.ObjectId,
) {
  const email = input.email.trim().toLowerCase();
  try {
    validateAdminPasswordStrength(input.password, email);
  } catch (error) {
    throw validationError(
      error instanceof Error ? error.message : 'Password is too weak.',
    );
  }

  const totpKey = getRequiredEnvSecret('TOTP_ENC_KEY');
  const passwordHash = await hashAdminPassword(input.password);
  const totpSecretEnc = encryptTotpSecret(generateSecret(), totpKey);

  try {
    const created = await AdminUserModel.create({
      email,
      passwordHash,
      role: input.role,
      totpSecretEnc,
      totpEnabled: false,
      failedLogins: 0,
      active: true,
      createdAt: new Date(),
    });

    await writeAuditLog({
      adminId: callerAdminId,
      action: 'user.create',
      targetType: 'admin_user',
      targetId: created._id,
      ...(input.reason ? { reason: input.reason } : {}),
      after: { email, role: input.role },
    });

    return { user: formatAdminUserPublic(created.toObject() as AdminUserLean) };
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null
        ? Reflect.get(error, 'code')
        : undefined;
    if (code === 11000) {
      throw duplicateActionError('An admin user with this email already exists.');
    }
    throw error;
  }
}

export async function updateAdminUser(
  targetUserIdHex: string,
  input: AdminUpdateUserBody,
  callerAdminId: Types.ObjectId,
) {
  const targetId = new Types.ObjectId(targetUserIdHex);
  const existing = (await AdminUserModel.findOne({ _id: targetId }).lean()) as
    | AdminUserLean
    | null;

  if (!existing) {
    throw notFoundError('Admin user was not found.');
  }

  if (
    targetId.equals(callerAdminId) &&
    (input.active === false || (input.role && input.role !== existing.role))
  ) {
    throw forbiddenError('You cannot deactivate or change your own admin role.');
  }

  if (
    existing.role === 'super' &&
    existing.active &&
    (input.active === false || (input.role && input.role !== 'super'))
  ) {
    const activeSuperCount = await AdminUserModel.countDocuments({
      role: 'super',
      active: true,
    });
    if (activeSuperCount <= 1) {
      throw forbiddenError('Cannot deactivate or demote the last active Super Admin.');
    }
  }

  const updated = (await AdminUserModel.findOneAndUpdate(
    { _id: targetId },
    {
      $set: {
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    },
    { new: true },
  ).lean()) as AdminUserLean | null;

  if (!updated) {
    throw notFoundError('Admin user was not found.');
  }

  if (updated.active === false) {
    await AdminSessionModel.deleteMany({ adminId: targetId });
  }

  await writeAuditLog({
    adminId: callerAdminId,
    action: 'user.update',
    targetType: 'admin_user',
    targetId,
    reason: input.reason,
    before: { role: existing.role, active: existing.active },
    after: { role: updated.role, active: updated.active },
  });

  return { user: formatAdminUserPublic(updated) };
}

export async function deleteAdminUser(
  targetUserIdHex: string,
  callerAdminId: Types.ObjectId,
  reason?: string,
) {
  const targetId = new Types.ObjectId(targetUserIdHex);
  if (targetId.equals(callerAdminId)) {
    throw forbiddenError('You cannot delete your own admin account.');
  }

  const existing = (await AdminUserModel.findOne({ _id: targetId }).lean()) as
    | AdminUserLean
    | null;
  if (!existing) {
    throw notFoundError('Admin user was not found.');
  }

  if (existing.role === 'super' && existing.active) {
    const activeSuperCount = await AdminUserModel.countDocuments({
      role: 'super',
      active: true,
    });
    if (activeSuperCount <= 1) {
      throw forbiddenError('Cannot delete the last active Super Admin.');
    }
  }

  // Soft-deactivate to preserve admin audit logs and moderation references (Database.md OD-20)
  const [updated] = await Promise.all([
    AdminUserModel.findOneAndUpdate(
      { _id: targetId },
      { $set: { active: false } },
      { new: true },
    ).lean() as Promise<AdminUserLean | null>,
    AdminSessionModel.deleteMany({ adminId: targetId }),
  ]);

  if (!updated) {
    throw notFoundError('Admin user was not found.');
  }

  await writeAuditLog({
    adminId: callerAdminId,
    action: 'user.delete',
    targetType: 'admin_user',
    targetId,
    ...(reason ? { reason } : {}),
    before: { email: existing.email, role: existing.role, active: existing.active },
    after: { email: updated.email, role: updated.role, active: updated.active },
  });

  return {
    deleted: true,
    active: updated.active,
    user: formatAdminUserPublic(updated),
  };
}

export async function resetAdminUser2fa(
  targetUserIdHex: string,
  reason: string,
  callerAdminId: Types.ObjectId,
) {
  const targetId = new Types.ObjectId(targetUserIdHex);
  const existing = (await AdminUserModel.findOne({ _id: targetId }).lean()) as
    | AdminUserLean
    | null;
  if (!existing) {
    throw notFoundError('Admin user was not found.');
  }

  const totpKey = getRequiredEnvSecret('TOTP_ENC_KEY');
  const nextTotpSecretEnc = encryptTotpSecret(generateSecret(), totpKey);

  await Promise.all([
    AdminUserModel.updateOne(
      { _id: targetId },
      { $set: { totpSecretEnc: nextTotpSecretEnc, totpEnabled: false } },
    ),
    AdminSessionModel.deleteMany({ adminId: targetId }),
  ]);

  await writeAuditLog({
    adminId: callerAdminId,
    action: 'user.reset2fa',
    targetType: 'admin_user',
    targetId,
    reason,
    after: { email: existing.email, totpEnabled: false },
  });

  return { reset: true, email: existing.email };
}

export async function listAuditLogs(
  query: AdminListAuditQuery,
  caller: { adminId: Types.ObjectId; role: AdminRole },
) {
  const andConditions: Array<Record<string, unknown>> = [];

  if (caller.role !== 'super') {
    andConditions.push({ adminId: caller.adminId });
  } else if (query.adminId) {
    if (!/^[0-9a-fA-F]{24}$/.test(query.adminId)) {
      throw validationError('Invalid adminId filter.');
    }
    andConditions.push({ adminId: new Types.ObjectId(query.adminId) });
  }

  if (query.targetType) andConditions.push({ targetType: query.targetType });
  if (query.targetId) {
    if (!/^[0-9a-fA-F]{24}$/.test(query.targetId)) {
      throw validationError('Invalid targetId filter.');
    }
    andConditions.push({ targetId: new Types.ObjectId(query.targetId) });
  }
  if (query.action) andConditions.push({ action: query.action });
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

  const docs = (await AuditLogModel.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(query.limit + 1)
    .lean()) as AuditLogLean[];

  const hasMore = docs.length > query.limit;
  const pageDocs = hasMore ? docs.slice(0, query.limit) : docs;
  const lastDoc = pageDocs[pageDocs.length - 1];

  const adminIds = Array.from(
    new Set(pageDocs.map((d) => d.adminId.toString())),
  ).map((id) => new Types.ObjectId(id));
  const admins =
    adminIds.length > 0
      ? await AdminUserModel.find({ _id: { $in: adminIds } })
          .select('email role')
          .lean()
      : [];
  const adminMap = new Map(
    admins.map((a) => [a._id.toString(), { email: a.email, role: a.role }]),
  );

  return {
    items: pageDocs.map((d) => {
      const adminInfo = adminMap.get(d.adminId.toString());
      return {
        id: d._id.toString(),
        adminId: d.adminId.toString(),
        adminEmail: adminInfo?.email ?? null,
        action: d.action,
        targetType: d.targetType ?? null,
        targetId: d.targetId ? d.targetId.toString() : null,
        reason: d.reason ?? null,
        before: d.before ?? null,
        after: d.after ?? null,
        createdAt: d.createdAt.toISOString(),
      };
    }),
    nextCursor:
      hasMore && lastDoc ? encodeCursor(lastDoc.createdAt, lastDoc._id) : null,
  };
}

export async function getAdminSettings() {
  const [freezeState, settingRows] = await Promise.all([
    getPlatformFreezeState(),
    SettingModel.find({
      key: {
        $in: [SETTING_KEYS.FREEZE_POSTING, SETTING_KEYS.FREEZE_COMMENTS],
      },
    }).lean(),
  ]);

  const byKey = new Map(settingRows.map((row) => [row.key, row]));
  return {
    freeze_posting: freezeState.freezePosting,
    freeze_comments: freezeState.freezeComments,
    updatedAt: {
      freeze_posting:
        byKey.get(SETTING_KEYS.FREEZE_POSTING)?.updatedAt?.toISOString() ?? null,
      freeze_comments:
        byKey.get(SETTING_KEYS.FREEZE_COMMENTS)?.updatedAt?.toISOString() ?? null,
    },
  };
}

export async function updateAdminSettings(
  input: AdminUpdateSettingsBody,
  callerAdminId: Types.ObjectId,
) {
  const before = await getPlatformFreezeState();
  const now = new Date();
  const ops: Promise<unknown>[] = [];

  if (input.freeze_posting !== undefined) {
    ops.push(
      SettingModel.findOneAndUpdate(
        { key: SETTING_KEYS.FREEZE_POSTING },
        {
          $set: {
            value: input.freeze_posting,
            updatedBy: callerAdminId,
            updatedAt: now,
          },
        },
        { upsert: true, new: true },
      ),
    );
  }

  if (input.freeze_comments !== undefined) {
    ops.push(
      SettingModel.findOneAndUpdate(
        { key: SETTING_KEYS.FREEZE_COMMENTS },
        {
          $set: {
            value: input.freeze_comments,
            updatedBy: callerAdminId,
            updatedAt: now,
          },
        },
        { upsert: true, new: true },
      ),
    );
  }

  await Promise.all(ops);
  const after = await getPlatformFreezeState();

  await writeAuditLog({
    adminId: callerAdminId,
    action: 'settings.update',
    targetType: 'settings',
    reason: input.reason,
    before: {
      freeze_posting: before.freezePosting,
      freeze_comments: before.freezeComments,
    },
    after: {
      freeze_posting: after.freezePosting,
      freeze_comments: after.freezeComments,
    },
    createdAt: now,
  });

  return getAdminSettings();
}
