import { Schema } from 'mongoose';
import {
  ACTOR_RESTRICTION_SCOPES,
  COLLECTIONS,
  LIMITS,
  PATTERNS,
} from '../constants/index.js';
import type { IActor, IActorRestriction } from '../types/index.js';
import {
  normalizeRequiredText,
  omitEmptyNormalizedText,
} from '../utils/text.js';
import { BASE_SCHEMA_OPTIONS, getOrCreateModel } from './model-helper.js';

const actorRestrictionSchema = new Schema<IActorRestriction>(
  {
    scope: {
      type: [
        {
          type: String,
          enum: ACTOR_RESTRICTION_SCOPES,
          required: true,
        },
      ],
      required: true,
      validate: {
        validator: (value: unknown): boolean =>
          Array.isArray(value) && value.length > 0,
        message: 'restriction.scope must be a non-empty array.',
      },
    },
    until: {
      type: Date,
      required: true,
    },
    reason: {
      type: String,
      required: true,
      set: normalizeRequiredText,
      minlength: 1,
      maxlength: LIMITS.MODERATION_REASON_MAX,
    },
    setBy: {
      type: Schema.Types.ObjectId,
      ref: 'AdminUser',
      required: true,
    },
    setAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
    strict: 'throw',
  },
);

const actorSchema = new Schema<IActor>(
  {
    actorId: {
      type: String,
      required: true,
      match: [PATTERNS.ACTOR_ID_HEX, 'actorId must be a 32-character hex string.'],
    },
    firstSeenAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    lastSeenAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    restriction: {
      type: actorRestrictionSchema,
    },
    restrictionHistory: {
      type: [actorRestrictionSchema],
      default: [],
    },
    notes: {
      type: String,
      set: omitEmptyNormalizedText,
    },
  },
  {
    ...BASE_SCHEMA_OPTIONS,
    collection: COLLECTIONS.ACTORS,
    timestamps: false,
  },
);

// Confirmed PRD indexes (Database.md §7.1 #17-#18)
actorSchema.index(
  { actorId: 1 },
  { unique: true, name: 'idx_actors_actorId_unique' },
);
actorSchema.index(
  { 'restriction.until': 1 },
  { name: 'idx_actors_restriction_until' },
);

export const ActorModel = getOrCreateModel<IActor>('Actor', actorSchema);
export { actorSchema };

