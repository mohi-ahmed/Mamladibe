import { Schema } from 'mongoose';
import { ADMIN_ROLES, COLLECTIONS, PATTERNS } from '../constants/index.js';
import type { IAdminUser } from '../types/index.js';
import {
  BASE_SCHEMA_OPTIONS,
  createSensitiveTransform,
  getOrCreateModel,
  INTEGER_VALIDATOR,
} from './model-helper.js';

const adminUserSchema = new Schema<IAdminUser>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: [PATTERNS.EMAIL, 'email must be a valid email address.'],
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      required: true,
      enum: ADMIN_ROLES,
    },
    totpSecretEnc: {
      type: String,
      required: true,
      select: false,
    },
    totpEnabled: {
      type: Boolean,
      required: true,
      default: false,
    },
    failedLogins: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: INTEGER_VALIDATOR,
    },
    lockedUntil: {
      type: Date,
    },
    active: {
      type: Boolean,
      required: true,
      default: true,
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    lastLoginAt: {
      type: Date,
    },
  },
  {
    ...BASE_SCHEMA_OPTIONS,
    collection: COLLECTIONS.ADMIN_USERS,
    timestamps: false,
    toJSON: {
      transform: createSensitiveTransform(['passwordHash', 'totpSecretEnc']),
    },
  },
);

// Confirmed PRD index (Database.md §7.1 #23)
adminUserSchema.index(
  { email: 1 },
  { unique: true, name: 'idx_admin_users_email_unique' },
);

export const AdminUserModel = getOrCreateModel<IAdminUser>(
  'AdminUser',
  adminUserSchema,
);
export { adminUserSchema };

