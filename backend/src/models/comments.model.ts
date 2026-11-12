import { Schema } from 'mongoose';
import {
  COLLECTIONS,
  COMMENT_STATUSES,
  COMMENT_TYPES,
  LIMITS,
  PATTERNS,
} from '../constants/index.js';
import type { IComment } from '../types/index.js';
import { countLineBreaks, normalizeRequiredText } from '../utils/text.js';
import { BASE_SCHEMA_OPTIONS, getOrCreateModel } from './model-helper.js';

const commentSchema = new Schema<IComment>(
  {
    incidentId: {
      type: Schema.Types.ObjectId,
      ref: 'Incident',
      required: true,
    },
    actorId: {
      type: String,
      required: true,
      match: [PATTERNS.ACTOR_ID_HEX, 'actorId must be a 32-character hex string.'],
    },
    type: {
      type: String,
      required: true,
      enum: COMMENT_TYPES,
    },
    body: {
      type: String,
      required: true,
      set: normalizeRequiredText,
      minlength: LIMITS.COMMENT.min,
      maxlength: LIMITS.COMMENT.max,
      validate: {
        validator: (value: string): boolean =>
          countLineBreaks(value) <= LIMITS.COMMENT.maxLineBreaks,
        message: `Comment body cannot exceed ${LIMITS.COMMENT.maxLineBreaks} line breaks.`,
      },
    },
    status: {
      type: String,
      required: true,
      enum: COMMENT_STATUSES,
      default: 'published',
    },
    redacted: {
      type: Boolean,
      required: true,
      default: false,
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    hiddenAt: {
      type: Date,
    },
    deletedAt: {
      type: Date,
    },
    purgeAt: {
      type: Date,
    },
  },
  {
    ...BASE_SCHEMA_OPTIONS,
    collection: COLLECTIONS.COMMENTS,
    timestamps: false,
  },
);

// Database.md §7.1 #9-#10 + PRD §8.3 purgeAt TTL
commentSchema.index(
  { incidentId: 1, status: 1, createdAt: -1 },
  { name: 'idx_comments_incidentId_status_createdAt' },
);
commentSchema.index(
  { actorId: 1, createdAt: -1 },
  { name: 'idx_comments_actorId_createdAt' },
);
commentSchema.index(
  { purgeAt: 1 },
  {
    expireAfterSeconds: 0,
    partialFilterExpression: { purgeAt: { $exists: true } },
    name: 'idx_comments_purgeAt_ttl',
  },
);

export const CommentModel = getOrCreateModel<IComment>('Comment', commentSchema);
export { commentSchema };

