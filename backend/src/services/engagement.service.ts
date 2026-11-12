import { Types } from 'mongoose';
import { ERROR_CODES, LIMITS, PATTERNS } from '../constants/index.js';
import {
  consumeFlagActionLimit,
  consumeVoteActionLimit,
} from '../lib/ratelimit.js';
import {
  assertNoContactInfo,
  normalizeOptionalContentText,
} from '../lib/text-rules.js';
import {
  CommentModel,
  IncidentModel,
  ReportModel,
  VoteModel,
} from '../models/index.js';
import type { FlagReason, VoteType } from '../types/index.js';
import {
  AppError,
  duplicateActionError,
  internalError,
  notFoundError,
  validationError,
} from '../utils/errors.js';
import { recordAbuseSignal } from './abuse-signal.service.js';
import { ensureActorCanPerform, recordActorActivity } from './actor.service.js';

function assertRequiredIpHash(ipHash: string | undefined, contextLabel: string): string {
  if (!ipHash || !PATTERNS.IP_HASH_HEX.test(ipHash)) {
    throw internalError(`IP hash is required for ${contextLabel}.`, 500);
  }
  return ipHash;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === 11000
  );
}

async function consumeActionLimitWithSignal(
  consumeLimit: (actorId: string) => Promise<void>,
  actorId: string,
  ipHash: string,
): Promise<void> {
  try {
    await consumeLimit(actorId);
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.RATE_LIMITED) {
      await recordAbuseSignal({ ipHash, actorId, type: 'rate_limit_hit' });
    }
    throw error;
  }
}

function validateAndNormalizeFlagNote(rawNote: string | undefined): string | undefined {
  const normalizedNote = normalizeOptionalContentText(rawNote);
  if (normalizedNote && normalizedNote.length > LIMITS.FLAG_NOTE_MAX) {
    throw validationError('Flag note exceeds maximum length.', {
      fields: [
        {
          path: 'note',
          message: `Flag note cannot exceed ${LIMITS.FLAG_NOTE_MAX} characters.`,
        },
      ],
    });
  }
  assertNoContactInfo({ note: normalizedNote });
  return normalizedNote;
}

async function findPublishedIncidentId(trackingId: string): Promise<Types.ObjectId> {
  const incident = await IncidentModel.findOne({
    trackingId,
    status: 'published',
  })
    .select('_id')
    .lean();

  if (!incident) {
    throw notFoundError('Incident was not found.');
  }
  return incident._id as Types.ObjectId;
}

async function computeVoteCounts(incidentId: Types.ObjectId): Promise<{
  support: number;
  dispute: number;
}> {
  const rows = await VoteModel.aggregate<{ _id: VoteType; count: number }>([
    { $match: { incidentId } },
    { $group: { _id: '$type', count: { $sum: 1 } } },
  ]);

  let support = 0;
  let dispute = 0;
  for (const row of rows) {
    if (row._id === 'support') support = row.count;
    if (row._id === 'dispute') dispute = row.count;
  }
  return { support, dispute };
}

export async function upsertIncidentVote(
  trackingId: string,
  actorId: string,
  type: VoteType,
  ipHash?: string,
) {
  const validIpHash = assertRequiredIpHash(ipHash, 'vote submission');
  const incidentId = await findPublishedIncidentId(trackingId);

  await ensureActorCanPerform(actorId, 'vote');
  await consumeActionLimitWithSignal(consumeVoteActionLimit, actorId, validIpHash);

  const now = new Date();
  const applyVoteUpsert = () =>
    VoteModel.findOneAndUpdate(
      { incidentId, actorId },
      {
        $set: { type, updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true, new: true },
    );

  try {
    await applyVoteUpsert();
  } catch (error) {
    // Concurrent initial upserts on (incidentId, actorId) can race E11000 before insert commits;
    // retrying once resolves deterministically against the existing document.
    if (isDuplicateKeyError(error)) {
      await applyVoteUpsert();
    } else {
      throw error;
    }
  }

  const counts = await computeVoteCounts(incidentId);
  return {
    counts,
    my: { vote: type },
  };
}

export async function removeIncidentVote(
  trackingId: string,
  actorId: string,
  ipHash?: string,
) {
  const validIpHash = assertRequiredIpHash(ipHash, 'vote removal');
  const incidentId = await findPublishedIncidentId(trackingId);

  await ensureActorCanPerform(actorId, 'vote');
  await consumeActionLimitWithSignal(consumeVoteActionLimit, actorId, validIpHash);

  await VoteModel.deleteOne({ incidentId, actorId });
  const counts = await computeVoteCounts(incidentId);

  return {
    counts,
    my: { vote: null },
  };
}

export async function reportIncident(
  trackingId: string,
  actorId: string,
  input: { reason: FlagReason; note?: string },
  ipHash?: string,
) {
  const validIpHash = assertRequiredIpHash(ipHash, 'incident reporting');
  const normalizedNote = validateAndNormalizeFlagNote(input.note);
  const incidentId = await findPublishedIncidentId(trackingId);

  await consumeActionLimitWithSignal(consumeFlagActionLimit, actorId, validIpHash);
  await recordActorActivity(actorId);

  try {
    await ReportModel.create({
      targetType: 'incident',
      targetId: incidentId,
      actorId,
      reason: input.reason,
      ...(normalizedNote ? { note: normalizedNote } : {}),
      status: 'open',
      createdAt: new Date(),
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw duplicateActionError('You have already reported this incident.');
    }
    throw error;
  }

  const flags = await ReportModel.countDocuments({
    targetType: 'incident',
    targetId: incidentId,
  });

  return {
    reported: true,
    flags,
  };
}

export async function reportComment(
  commentIdHex: string,
  actorId: string,
  input: { reason: FlagReason; note?: string },
  ipHash?: string,
) {
  const validIpHash = assertRequiredIpHash(ipHash, 'comment reporting');
  const normalizedNote = validateAndNormalizeFlagNote(input.note);

  const commentObjectId = new Types.ObjectId(commentIdHex);
  const comment = await CommentModel.findOne({
    _id: commentObjectId,
    status: 'published',
  })
    .select('_id incidentId')
    .lean();

  if (!comment) {
    throw notFoundError('Comment was not found.');
  }

  const parentPublished = await IncidentModel.exists({
    _id: comment.incidentId,
    status: 'published',
  });
  if (!parentPublished) {
    throw notFoundError('Comment was not found.');
  }

  await consumeActionLimitWithSignal(consumeFlagActionLimit, actorId, validIpHash);
  await recordActorActivity(actorId);

  try {
    await ReportModel.create({
      targetType: 'comment',
      targetId: comment._id,
      actorId,
      reason: input.reason,
      ...(normalizedNote ? { note: normalizedNote } : {}),
      status: 'open',
      createdAt: new Date(),
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw duplicateActionError('You have already reported this comment.');
    }
    throw error;
  }

  // Flag counts on comments are intentionally omitted publicly (PRD FR-13.7)
  return {
    reported: true,
  };
}

