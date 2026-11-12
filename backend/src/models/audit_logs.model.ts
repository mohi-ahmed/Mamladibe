import { Schema } from 'mongoose';
import { COLLECTIONS, LIMITS } from '../constants/index.js';
import type { IAuditLog } from '../types/index.js';
import { omitEmptyNormalizedText } from '../utils/text.js';
import { BASE_SCHEMA_OPTIONS, getOrCreateModel } from './model-helper.js';

const auditLogSchema = new Schema<IAuditLog>(
  {
    adminId: {
      type: Schema.Types.ObjectId,
      ref: 'AdminUser',
      required: true,
    },
    action: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
    targetType: {
      type: String,
      trim: true,
    },
    targetId: {
      type: Schema.Types.ObjectId,
    },
    reason: {
      type: String,
      set: omitEmptyNormalizedText,
      maxlength: LIMITS.MODERATION_REASON_MAX,
    },
    before: {
      type: Schema.Types.Mixed,
    },
    after: {
      type: Schema.Types.Mixed,
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    ...BASE_SCHEMA_OPTIONS,
    collection: COLLECTIONS.AUDIT_LOGS,
    timestamps: false,
  },
);

function rejectAuditMutation(): never {
  throw new Error(
    'audit_logs is append-only in application code; updates and deletions are prohibited.',
  );
}

// Enforce append-only semantics at the Mongoose application layer (PRD R-S7 & §10)
auditLogSchema.pre('updateOne', { document: true, query: true }, rejectAuditMutation);
auditLogSchema.pre('deleteOne', { document: true, query: true }, rejectAuditMutation);
auditLogSchema.pre('updateMany', rejectAuditMutation);
auditLogSchema.pre('deleteMany', rejectAuditMutation);
auditLogSchema.pre('findOneAndUpdate', rejectAuditMutation);
auditLogSchema.pre('findOneAndDelete', rejectAuditMutation);
auditLogSchema.pre('replaceOne', rejectAuditMutation);
auditLogSchema.pre('findOneAndReplace', rejectAuditMutation);

// Confirmed PRD indexes (Database.md §7.1 #26-#27 + PRD §8.12 createdAt)
auditLogSchema.index(
  { targetType: 1, targetId: 1 },
  { name: 'idx_audit_logs_targetType_targetId' },
);
auditLogSchema.index(
  { adminId: 1, createdAt: -1 },
  { name: 'idx_audit_logs_adminId_createdAt' },
);
auditLogSchema.index(
  { createdAt: -1 },
  { name: 'idx_audit_logs_createdAt' },
);

export const AuditLogModel = getOrCreateModel<IAuditLog>(
  'AuditLog',
  auditLogSchema,
);
export { auditLogSchema };

