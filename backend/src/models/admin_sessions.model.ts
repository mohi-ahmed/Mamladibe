import { Schema } from 'mongoose';
import {
  ADMIN_SESSION_STAGES,
  COLLECTIONS,
  PATTERNS,
  TTL_SECONDS,
} from '../constants/index.js';
import type { IAdminSession } from '../types/index.js';
import {
  BASE_SCHEMA_OPTIONS,
  createSensitiveTransform,
  getOrCreateModel,
} from './model-helper.js';

const adminSessionSchema = new Schema<IAdminSession>(
  {
    adminId: {
      type: Schema.Types.ObjectId,
      ref: 'AdminUser',
      required: true,
    },
    sessionHash: {
      type: String,
      required: true,
      match: [PATTERNS.SHA256_HEX, 'sessionHash must be a 64-character hex SHA-256 hash.'],
      select: false,
    },
    stage: {
      type: String,
      required: true,
      enum: ADMIN_SESSION_STAGES,
      default: 'pending_2fa',
    },
    csrfToken: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    lastSeenAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    ...BASE_SCHEMA_OPTIONS,
    collection: COLLECTIONS.ADMIN_SESSIONS,
    timestamps: false,
    toJSON: {
      transform: createSensitiveTransform(['sessionHash']),
    },
  },
);

// Confirmed PRD indexes (Database.md §7.1 #24-#25)
adminSessionSchema.index(
  { expiresAt: 1 },
  {
    expireAfterSeconds: TTL_SECONDS.IMMEDIATE_AT_FIELD,
    name: 'idx_admin_sessions_expiresAt_ttl',
  },
);
adminSessionSchema.index(
  { sessionHash: 1 },
  { unique: true, name: 'idx_admin_sessions_sessionHash_unique' },
);

export const AdminSessionModel = getOrCreateModel<IAdminSession>(
  'AdminSession',
  adminSessionSchema,
);
export { adminSessionSchema };

