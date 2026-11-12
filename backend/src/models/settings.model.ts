import { Schema } from 'mongoose';
import { COLLECTIONS } from '../constants/index.js';
import type { ISetting } from '../types/index.js';
import { BASE_SCHEMA_OPTIONS, getOrCreateModel } from './model-helper.js';

const settingSchema = new Schema<ISetting>(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
    value: {
      type: Schema.Types.Mixed,
      required: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'AdminUser',
      required: true,
    },
  },
  {
    ...BASE_SCHEMA_OPTIONS,
    collection: COLLECTIONS.SETTINGS,
    timestamps: { createdAt: false, updatedAt: true },
  },
);

// Confirmed PRD index (Database.md §7.1 #28)
settingSchema.index(
  { key: 1 },
  { unique: true, name: 'idx_settings_key_unique' },
);

export const SettingModel = getOrCreateModel<ISetting>(
  'Setting',
  settingSchema,
);
export { settingSchema };

