import { Types } from 'mongoose';
import { EDIT, ERROR_CODES, LIMITS, PATTERNS, RATE, RETENTION } from '../constants/index.js';
import { verifyTurnstileToken } from '../lib/captcha.js';
import { decodeCursor, encodeCursor } from '../lib/cursor.js';
import {
  addDays,
  addMinutes,
  getDailyQuotaExpiresAt,
  getDhakaDayKey,
  getNextDhakaMidnightUtc,
} from '../lib/dhaka-time.js';
import {
  acquireCommentCooldown,
  getCommentIpHitCount,
  getRemainingCommentCooldownSeconds,
  recordCommentIpHit,
  releaseCommentCooldown,
} from '../lib/ratelimit.js';
import {
  assertNoContactInfo,
  normalizeContentText,
} from '../lib/text-rules.js';
import {
  CommentModel,
  DailyQuotaModel,
  IncidentModel,
} from '../models/index.js';
import type { IComment } from '../types/index.js';
import {
  AppError,
  editWindowClosedError,
  forbiddenError,
  internalError,
  notFoundError,
  quotaExceededError,
  rateLimitedError,
  validationError,
} from '../utils/errors.js';
import { countLineBreaks } from '../utils/text.js';
import type { CreateCommentInput } from '../validators/public.validator.js';
import { isIpRiskElevated, recordAbuseSignal } from './abuse-signal.service.js';
import { ensureActorCanPerform } from './actor.service.js';
import { assertCommentsNotFrozen } from './settings.service.js';

type CommentLean = IComment & { _id: Types.ObjectId };

export async function listPublicComments(
  trackingId: string,
  callerActorId: string | undefined,
  options: { limit: number; cursor?: string },
) {
  const incident = await IncidentModel.findOne({
    trackingId,
    status: 'published',
  })
    .select('_id')
    .lean();

  if (!incident) {
    throw notFoundError('Incident was not found.');
  }

  const filter: Record<string, unknown> = {
    incidentId: incident._id,
    status: { $in: ['published', 'hidden'] },
  };

  if (options.cursor) {
    const cursor = decodeCursor(options.cursor);
    filter.$or = [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
    ];
  }

  const docs = (await CommentModel.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(options.limit + 1)
    .lean()) as CommentLean[];

  const hasMore = docs.length > options.limit;
  const pageDocs = hasMore ? docs.slice(0, options.limit) : docs;
  const lastDoc = pageDocs[pageDocs.length - 1];

  return {
    items: pageDocs.map((doc) => {
      if (doc.status === 'hidden') {
        return {
          id: doc._id.toString(),
          type: doc.type,
          body: null,
          placeholder: true,
          redacted: false,
          createdAt: doc.createdAt.toISOString(),
          mine: false,
        };
      }

      return {
        id: doc._id.toString(),
        type: doc.type,
        body: doc.body,
        placeholder: false,
        redacted: doc.redacted,
        createdAt: doc.createdAt.toISOString(),
        mine: Boolean(callerActorId && doc.actorId === callerActorId),
      };
    }),
    nextCursor:
      hasMore && lastDoc ? encodeCursor(lastDoc.createdAt, lastDoc._id) : null,
  };
}

export async function getMyCommentQuota(actorId: string) {
  const now = new Date();
  const day = getDhakaDayKey(now);
  const resetsAt = getNextDhakaMidnightUtc(now).toISOString();

  const quota = await DailyQuotaModel.findOne({
    actorId,
    day,
    kind: 'comment',
  })
    .select('count')
    .lean();

  const used = quota?.count ?? 0;
  return {
    commentsLeft: Math.max(0, RATE.COMMENTS_PER_ACTOR_PER_DAY - used),
    limit: RATE.COMMENTS_PER_ACTOR_PER_DAY,
    resetsAt,
  };
}

async function verifyCommentCaptchaOrRecordSignal(
  captchaToken: string | undefined,
  context: { actorId: string; ipHash: string; clientIp?: string },
): Promise<void> {
  try {
    await verifyTurnstileToken(captchaToken, context.clientIp);
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
}

export async function createComment(
  trackingId: string,
  input: CreateCommentInput,
  context: { actorId: string; ipHash: string; clientIp?: string },
) {
  if (!context.ipHash || !PATTERNS.IP_HASH_HEX.test(context.ipHash)) {
    throw internalError('IP hash is required for comment submission.', 500);
  }

  // 1. Validate and normalize text before incident lookup, actor write, cooldown, or quota.
  const body = normalizeContentText(input.body);
  if (body.length < LIMITS.COMMENT.min || body.length > LIMITS.COMMENT.max) {
    throw validationError('Comment length is out of range.', {
      fields: [{ path: 'body', message: 'Comment length must be 5 to 500 characters.' }],
    });
  }
  if (countLineBreaks(body) > LIMITS.COMMENT.maxLineBreaks) {
    throw validationError('Comment exceeds maximum allowed line breaks.', {
      fields: [
        {
          path: 'body',
          message: `Comment cannot exceed ${LIMITS.COMMENT.maxLineBreaks} line breaks.`,
        },
      ],
    });
  }
  assertNoContactInfo({ body });

  // 2. Verify target incident is published before touching actor state, cooldown, or quota.
  const incident = await IncidentModel.findOne({
    trackingId,
    status: 'published',
  })
    .select('_id')
    .lean();
  if (!incident) {
    throw notFoundError('Incident was not found.');
  }

  // 3. Enforce actor restrictions and global comment freeze.
  await ensureActorCanPerform(context.actorId, 'comment');
  await assertCommentsNotFrozen();

  // 4. Non-destructive cooldown pre-check prevents consuming Turnstile tokens while locked.
  const activeCooldownSec = await getRemainingCommentCooldownSeconds(context.actorId);
  if (activeCooldownSec > 0) {
    await recordAbuseSignal({
      ipHash: context.ipHash,
      actorId: context.actorId,
      type: 'rate_limit_hit',
    });
    throw rateLimitedError('Please wait before posting another comment.', {
      retryAfterSeconds: activeCooldownSec,
    });
  }

  // 5. Preflight CAPTCHA check when IP soft cap or risk is already elevated so unmet
  //    CAPTCHA never consumes the actor's 30-second cooldown, IP hits, or daily quota.
  const now = new Date();
  const currentIpHits = await getCommentIpHitCount(context.ipHash, now);
  const preflightElevated =
    currentIpHits >= RATE.COMMENTS_PER_IP_PER_DAY_SOFT ||
    (await isIpRiskElevated(context.ipHash));

  let captchaVerified = false;
  if (preflightElevated) {
    await verifyCommentCaptchaOrRecordSignal(input.captchaToken, context);
    captchaVerified = true;
  }

  // 6. Atomically acquire 30-second cooldown lock (guards concurrent submissions per actor).
  const cooldown = await acquireCommentCooldown(context.actorId);
  if (!cooldown.allowed) {
    await recordAbuseSignal({
      ipHash: context.ipHash,
      actorId: context.actorId,
      type: 'rate_limit_hit',
    });
    throw rateLimitedError('Please wait before posting another comment.', {
      retryAfterSeconds: cooldown.retryAfterSeconds ?? RATE.COMMENT_COOLDOWN_SEC,
    });
  }

  // 7. Atomically record hashed-IP hit; handle the rare concurrent boundary race crossing 30 -> 31.
  const ipCap = await recordCommentIpHit(context.ipHash, now);
  if (ipCap.softCapExceeded) {
    await recordAbuseSignal({
      ipHash: context.ipHash,
      actorId: context.actorId,
      type: 'comment_ip_soft_cap',
    });
  }

  if (ipCap.softCapExceeded && !captchaVerified) {
    try {
      await verifyCommentCaptchaOrRecordSignal(input.captchaToken, context);
      captchaVerified = true;
    } catch (error) {
      await releaseCommentCooldown(context.actorId).catch(() => undefined);
      throw error;
    }
  }

  const day = getDhakaDayKey(now);
  const resetsAt = getNextDhakaMidnightUtc(now).toISOString();
  const expiresAt = getDailyQuotaExpiresAt(now);

  let updatedCount: number;
  try {
    const quotaDoc = await DailyQuotaModel.findOneAndUpdate(
      {
        actorId: context.actorId,
        day,
        kind: 'comment',
        count: { $lt: RATE.COMMENTS_PER_ACTOR_PER_DAY },
      },
      {
        $inc: { count: 1 },
        $setOnInsert: { expiresAt },
      },
      { upsert: true, new: true },
    ).lean();

    if (!quotaDoc) {
      throw internalError('Failed to update daily comment quota.');
    }

    updatedCount = quotaDoc.count;
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null
        ? Reflect.get(error, 'code')
        : undefined;
    if (code === 11000) {
      throw quotaExceededError('Daily comment limit reached.', { resetsAt });
    }
    throw error;
  }

  // Quota is intentionally consumed prior to insert and never refunded on failure (PRD §9.4)
  const created = await CommentModel.create({
    incidentId: incident._id,
    actorId: context.actorId,
    type: input.type,
    body,
    status: 'published',
    redacted: false,
    createdAt: now,
  });

  return {
    comment: {
      id: created._id.toString(),
      type: created.type,
      body: created.body,
      placeholder: false,
      redacted: false,
      createdAt: created.createdAt.toISOString(),
      mine: true,
    },
    quota: {
      commentsLeft: Math.max(0, RATE.COMMENTS_PER_ACTOR_PER_DAY - updatedCount),
      resetsAt,
    },
  };
}

export async function deleteOwnComment(commentIdHex: string, actorId: string) {
  const commentObjectId = new Types.ObjectId(commentIdHex);
  const comment = await CommentModel.findOne({ _id: commentObjectId }).lean();

  if (!comment || comment.status !== 'published') {
    throw notFoundError('Comment was not found.');
  }

  const parentPublished = await IncidentModel.exists({
    _id: comment.incidentId,
    status: 'published',
  });
  if (!parentPublished) {
    throw notFoundError('Comment was not found.');
  }

  if (comment.actorId !== actorId) {
    throw forbiddenError('You can only delete your own comments.');
  }

  const now = new Date();
  const deadline = addMinutes(comment.createdAt, EDIT.COMMENT_SELF_DELETE_MINUTES);
  if (now.getTime() > deadline.getTime()) {
    throw editWindowClosedError('The 15-minute comment deletion window has closed.');
  }

  const updateResult = await CommentModel.updateOne(
    { _id: commentObjectId, actorId, status: 'published' },
    {
      $set: {
        status: 'deleted',
        deletedAt: now,
        purgeAt: addDays(now, RETENTION.SOFT_DELETE_DAYS),
      },
    },
  );

  if (updateResult.modifiedCount === 0) {
    throw notFoundError('Comment was not found.');
  }

  return { deleted: true };
}

