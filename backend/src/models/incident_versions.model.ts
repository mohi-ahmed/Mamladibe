import { Schema } from 'mongoose';
import { COLLECTIONS, EDIT_AUTHORS, LIMITS } from '../constants/index.js';
import type { IIncidentVersion } from '../types/index.js';
import {
  normalizeRequiredText,
  omitEmptyNormalizedText,
} from '../utils/text.js';
import {
  BASE_SCHEMA_OPTIONS,
  getOrCreateModel,
  INTEGER_VALIDATOR,
} from './model-helper.js';

const incidentVersionSchema = new Schema<IIncidentVersion>(
  {
    incidentId: {
      type: Schema.Types.ObjectId,
      ref: 'Incident',
      required: true,
    },
    version: {
      type: Number,
      required: true,
      min: 1,
      validate: INTEGER_VALIDATOR,
    },
    title: {
      type: String,
      required: true,
      set: normalizeRequiredText,
      minlength: LIMITS.TITLE.min,
      maxlength: LIMITS.TITLE.max,
    },
    description: {
      type: String,
      required: true,
      set: normalizeRequiredText,
      minlength: LIMITS.DESCRIPTION.min,
      maxlength: LIMITS.DESCRIPTION.max,
    },
    safetyTip: {
      type: String,
      set: omitEmptyNormalizedText,
      maxlength: LIMITS.SAFETY_TIP_MAX,
    },
    editedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    editedBy: {
      type: String,
      required: true,
      enum: EDIT_AUTHORS,
    },
    reason: {
      type: String,
      required: function (this: IIncidentVersion): boolean {
        return this.editedBy === 'moderator';
      },
      set: omitEmptyNormalizedText,
      maxlength: LIMITS.MODERATION_REASON_MAX,
    },
  },
  {
    ...BASE_SCHEMA_OPTIONS,
    collection: COLLECTIONS.INCIDENT_VERSIONS,
    timestamps: false,
  },
);

// Database.md §7.1 #8
incidentVersionSchema.index(
  { incidentId: 1, version: 1 },
  { unique: true, name: 'idx_incident_versions_incidentId_version_unique' },
);

export const IncidentVersionModel = getOrCreateModel<IIncidentVersion>(
  'IncidentVersion',
  incidentVersionSchema,
);
export { incidentVersionSchema };

