import { Schema } from 'mongoose';
import {
  CATEGORIES,
  COLLECTIONS,
  EDIT,
  INCIDENT_SOURCES,
  INCIDENT_STATUSES,
  LIMITS,
  MODERATION_OUTCOMES,
  PATTERNS,
} from '../constants/index.js';
import type { IGeoPoint, IIncident } from '../types/index.js';
import { isWithinBangladeshBounds } from '../utils/geo.js';
import {
  normalizeRequiredText,
  omitEmptyNormalizedText,
} from '../utils/text.js';
import {
  BASE_SCHEMA_OPTIONS,
  createSensitiveTransform,
  getOrCreateModel,
  INTEGER_VALIDATOR,
} from './model-helper.js';

const geoPointSchema = new Schema<IGeoPoint>(
  {
    type: {
      type: String,
      enum: ['Point'],
      required: true,
      default: 'Point',
    },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (value: unknown): boolean => isWithinBangladeshBounds(value),
        message:
          'location.coordinates must be [longitude, latitude] within Bangladesh bounds.',
      },
    },
  },
  {
    _id: false,
    strict: 'throw',
  },
);

const incidentSchema = new Schema<IIncident>(
  {
    trackingId: {
      type: String,
      required: true,
      trim: true,
      match: [PATTERNS.TRACKING_ID, 'Invalid trackingId format.'],
    },
    secretHash: {
      type: String,
      required: function (this: IIncident): boolean {
        return this.source === 'public';
      },
      match: [PATTERNS.SHA256_HEX, 'secretHash must be a 64-character hex SHA-256 hash.'],
      select: false,
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
    category: {
      type: String,
      required: true,
      enum: CATEGORIES,
    },
    incidentAt: {
      type: Date,
      required: true,
    },
    location: {
      type: geoPointSchema,
      required: true,
    },
    roadName: {
      type: String,
      set: omitEmptyNormalizedText,
      maxlength: LIMITS.PLACE_TEXT_MAX,
    },
    areaName: {
      type: String,
      set: omitEmptyNormalizedText,
      maxlength: LIMITS.PLACE_TEXT_MAX,
    },
    upazila: {
      type: String,
      set: omitEmptyNormalizedText,
      maxlength: LIMITS.PLACE_TEXT_MAX,
    },
    district: {
      type: String,
      set: omitEmptyNormalizedText,
      maxlength: LIMITS.PLACE_TEXT_MAX,
    },
    safetyTip: {
      type: String,
      set: omitEmptyNormalizedText,
      maxlength: LIMITS.SAFETY_TIP_MAX,
    },
    status: {
      type: String,
      required: true,
      enum: INCIDENT_STATUSES,
      default: 'published',
    },
    isEdited: {
      type: Boolean,
      required: true,
      default: false,
    },
    editedAt: {
      type: Date,
    },
    editCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      max: EDIT.MAX_EDITS,
      validate: INTEGER_VALIDATOR,
    },
    moderatedEdit: {
      type: Boolean,
      required: true,
      default: false,
    },
    source: {
      type: String,
      required: true,
      enum: INCIDENT_SOURCES,
      default: 'public',
    },
    actorId: {
      type: String,
      required: function (this: IIncident): boolean {
        return this.source === 'public';
      },
      match: [PATTERNS.ACTOR_ID_HEX, 'actorId must be a 32-character hex string.'],
    },
    contentHash: {
      type: String,
      required: function (this: IIncident): boolean {
        return this.source === 'public';
      },
      match: [PATTERNS.SHA256_HEX, 'contentHash must be a 64-character hex SHA-256 hash.'],
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
    moderationOutcome: {
      type: String,
      enum: MODERATION_OUTCOMES,
    },
  },
  {
    ...BASE_SCHEMA_OPTIONS,
    collection: COLLECTIONS.INCIDENTS,
    timestamps: false,
    toJSON: {
      transform: createSensitiveTransform(['secretHash']),
    },
  },
);

// Confirmed PRD indexes (Database.md §7.1 #1-#7 + PRD §8.1 purgeAt TTL)
incidentSchema.index(
  { trackingId: 1 },
  { unique: true, name: 'idx_incidents_trackingId_unique' },
);
incidentSchema.index(
  { location: '2dsphere' },
  { name: 'idx_incidents_location_2dsphere' },
);
incidentSchema.index(
  { status: 1, createdAt: -1 },
  { name: 'idx_incidents_status_createdAt' },
);
incidentSchema.index(
  { category: 1, createdAt: -1 },
  { name: 'idx_incidents_category_createdAt' },
);
incidentSchema.index(
  { district: 1, createdAt: -1 },
  { name: 'idx_incidents_district_createdAt' },
);
incidentSchema.index(
  { title: 'text', description: 'text', roadName: 'text', areaName: 'text' },
  { default_language: 'none', name: 'idx_incidents_text_search' },
);
incidentSchema.index(
  { actorId: 1, createdAt: -1 },
  { name: 'idx_incidents_actorId_createdAt' },
);
incidentSchema.index(
  { purgeAt: 1 },
  {
    expireAfterSeconds: 0,
    partialFilterExpression: { purgeAt: { $exists: true } },
    name: 'idx_incidents_purgeAt_ttl',
  },
);

export const IncidentModel = getOrCreateModel<IIncident>(
  'Incident',
  incidentSchema,
);
export { incidentSchema };

