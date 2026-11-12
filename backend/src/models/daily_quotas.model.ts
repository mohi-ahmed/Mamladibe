import { Schema } from 'mongoose';
import {
  COLLECTIONS,
  PATTERNS,
  QUOTA_KINDS,
  RATE,
  TTL_SECONDS,
} from '../constants/index.js';
import type { IDailyQuota } from '../types/index.js';
import {
  BASE_SCHEMA_OPTIONS,
  getOrCreateModel,
  INTEGER_VALIDATOR,
} from './model-helper.js';

const dailyQuotaSchema = new Schema<IDailyQuota>(
  {
    actorId: {
      type: String,
      required: true,
      match: [PATTERNS.ACTOR_ID_HEX, 'actorId must be a 32-character hex string.'],
    },
    day: {
      type: String,
      required: true,
      match: [PATTERNS.QUOTA_DAY, 'day must follow YYYY-MM-DD format.'],
    },
    kind: {
      type: String,
      required: true,
      enum: QUOTA_KINDS,
      default: 'comment',
    },
    count: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      max: RATE.COMMENTS_PER_ACTOR_PER_DAY,
      validate: INTEGER_VALIDATOR,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    ...BASE_SCHEMA_OPTIONS,
    collection: COLLECTIONS.DAILY_QUOTAS,
    timestamps: false,
  },
);

// Confirmed PRD indexes (Database.md §7.1 #15-#16)
dailyQuotaSchema.index(
  { actorId: 1, day: 1, kind: 1 },
  { unique: true, name: 'idx_daily_quotas_actorId_day_kind_unique' },
);
dailyQuotaSchema.index(
  { expiresAt: 1 },
  {
    expireAfterSeconds: TTL_SECONDS.IMMEDIATE_AT_FIELD,
    name: 'idx_daily_quotas_expiresAt_ttl',
  },
);

export const DailyQuotaModel = getOrCreateModel<IDailyQuota>(
  'DailyQuota',
  dailyQuotaSchema,
);
export { dailyQuotaSchema };

