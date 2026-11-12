import { Schema } from 'mongoose';
import { COLLECTIONS, PATTERNS, TTL_SECONDS } from '../constants/index.js';
import type { IAbuseSignal } from '../types/index.js';
import { BASE_SCHEMA_OPTIONS, getOrCreateModel } from './model-helper.js';

const abuseSignalSchema = new Schema<IAbuseSignal>(
  {
    ipHash: {
      type: String,
      required: true,
      match: [PATTERNS.IP_HASH_HEX, 'ipHash must be a valid hex HMAC digest.'],
    },
    actorId: {
      type: String,
      match: [PATTERNS.ACTOR_ID_HEX, 'actorId must be a 32-character hex string.'],
    },
    type: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    ...BASE_SCHEMA_OPTIONS,
    collection: COLLECTIONS.ABUSE_SIGNALS,
    timestamps: false,
  },
);

// Confirmed PRD indexes (Database.md §7.1 #19-#20, sort dir per PRD §8.8)
abuseSignalSchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds: TTL_SECONDS.ABUSE_SIGNALS,
    name: 'idx_abuse_signals_createdAt_ttl',
  },
);
abuseSignalSchema.index(
  { ipHash: 1, createdAt: -1 },
  { name: 'idx_abuse_signals_ipHash_createdAt' },
);

export const AbuseSignalModel = getOrCreateModel<IAbuseSignal>(
  'AbuseSignal',
  abuseSignalSchema,
);
export { abuseSignalSchema };

