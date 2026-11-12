import { Schema } from 'mongoose';
import {
  COLLECTIONS,
  FLAG_REASONS,
  LIMITS,
  PATTERNS,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
} from '../constants/index.js';
import type { IReport } from '../types/index.js';
import { omitEmptyNormalizedText } from '../utils/text.js';
import { BASE_SCHEMA_OPTIONS, getOrCreateModel } from './model-helper.js';

const reportSchema = new Schema<IReport>(
  {
    targetType: {
      type: String,
      required: true,
      enum: REPORT_TARGET_TYPES,
    },
    targetId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    actorId: {
      type: String,
      required: true,
      match: [PATTERNS.ACTOR_ID_HEX, 'actorId must be a 32-character hex string.'],
    },
    reason: {
      type: String,
      required: true,
      enum: FLAG_REASONS,
    },
    note: {
      type: String,
      set: omitEmptyNormalizedText,
      maxlength: LIMITS.FLAG_NOTE_MAX,
    },
    status: {
      type: String,
      required: true,
      enum: REPORT_STATUSES,
      default: 'open',
    },
    resolvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'AdminUser',
    },
    resolvedAt: {
      type: Date,
    },
    resolutionNote: {
      type: String,
      set: omitEmptyNormalizedText,
      maxlength: LIMITS.MODERATION_REASON_MAX,
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    ...BASE_SCHEMA_OPTIONS,
    collection: COLLECTIONS.REPORTS,
    timestamps: false,
  },
);

// Confirmed PRD indexes (Database.md §7.1 #13-#14).
// Note: PROPOSED index #30 ({ actorId: 1, createdAt: 1 }) is intentionally omitted.
reportSchema.index(
  { targetType: 1, targetId: 1, actorId: 1 },
  { unique: true, name: 'idx_reports_targetType_targetId_actorId_unique' },
);
reportSchema.index(
  { status: 1, createdAt: 1 },
  { name: 'idx_reports_status_createdAt' },
);

export const ReportModel = getOrCreateModel<IReport>('Report', reportSchema);
export { reportSchema };

