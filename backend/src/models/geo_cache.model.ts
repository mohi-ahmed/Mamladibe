import { Schema } from 'mongoose';
import { COLLECTIONS, TTL_SECONDS } from '../constants/index.js';
import type { IGeoCache } from '../types/index.js';
import { BASE_SCHEMA_OPTIONS, getOrCreateModel } from './model-helper.js';

const geoCacheSchema = new Schema<IGeoCache>(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
    result: {
      type: Schema.Types.Mixed,
      required: true,
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    ...BASE_SCHEMA_OPTIONS,
    collection: COLLECTIONS.GEO_CACHE,
    timestamps: false,
  },
);

// Confirmed PRD indexes (Database.md §7.1 #21-#22)
geoCacheSchema.index(
  { key: 1 },
  { unique: true, name: 'idx_geo_cache_key_unique' },
);
geoCacheSchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds: TTL_SECONDS.GEO_CACHE,
    name: 'idx_geo_cache_createdAt_ttl',
  },
);

export const GeoCacheModel = getOrCreateModel<IGeoCache>(
  'GeoCache',
  geoCacheSchema,
);
export { geoCacheSchema };

