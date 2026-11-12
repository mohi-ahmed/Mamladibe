import type { IndexDefinition, IndexOptions } from 'mongoose';
import { COLLECTIONS } from '../constants/index.js';
import { AbuseSignalModel, abuseSignalSchema } from './abuse_signals.model.js';
import { ActorModel, actorSchema } from './actors.model.js';
import { AdminSessionModel, adminSessionSchema } from './admin_sessions.model.js';
import { AdminUserModel, adminUserSchema } from './admin_users.model.js';
import { AuditLogModel, auditLogSchema } from './audit_logs.model.js';
import { CommentModel, commentSchema } from './comments.model.js';
import { DailyQuotaModel, dailyQuotaSchema } from './daily_quotas.model.js';
import { GeoCacheModel, geoCacheSchema } from './geo_cache.model.js';
import {
  IncidentVersionModel,
  incidentVersionSchema,
} from './incident_versions.model.js';
import { IncidentModel, incidentSchema } from './incidents.model.js';
import { ReportModel, reportSchema } from './reports.model.js';
import { SettingModel, settingSchema } from './settings.model.js';
import { VoteModel, voteSchema } from './votes.model.js';

export {
  AbuseSignalModel,
  ActorModel,
  AdminSessionModel,
  AdminUserModel,
  AuditLogModel,
  CommentModel,
  DailyQuotaModel,
  GeoCacheModel,
  IncidentModel,
  IncidentVersionModel,
  ReportModel,
  SettingModel,
  VoteModel,
};

export {
  abuseSignalSchema,
  actorSchema,
  adminSessionSchema,
  adminUserSchema,
  auditLogSchema,
  commentSchema,
  dailyQuotaSchema,
  geoCacheSchema,
  incidentSchema,
  incidentVersionSchema,
  reportSchema,
  settingSchema,
  voteSchema,
};

export interface RegisteredCollection {
  readonly modelName: string;
  readonly collectionName: string;
  readonly getDeclaredIndexes: () => Array<[IndexDefinition, IndexOptions]>;
}

/**
 * Ordered registry of all 13 confirmed MongoDB collections matching
 * Database.md §4 and PRD §9.1.
 */
export const REGISTERED_COLLECTIONS: readonly RegisteredCollection[] = [
  {
    modelName: IncidentModel.modelName,
    collectionName: COLLECTIONS.INCIDENTS,
    getDeclaredIndexes: () => incidentSchema.indexes(),
  },
  {
    modelName: IncidentVersionModel.modelName,
    collectionName: COLLECTIONS.INCIDENT_VERSIONS,
    getDeclaredIndexes: () => incidentVersionSchema.indexes(),
  },
  {
    modelName: CommentModel.modelName,
    collectionName: COLLECTIONS.COMMENTS,
    getDeclaredIndexes: () => commentSchema.indexes(),
  },
  {
    modelName: VoteModel.modelName,
    collectionName: COLLECTIONS.VOTES,
    getDeclaredIndexes: () => voteSchema.indexes(),
  },
  {
    modelName: ReportModel.modelName,
    collectionName: COLLECTIONS.REPORTS,
    getDeclaredIndexes: () => reportSchema.indexes(),
  },
  {
    modelName: DailyQuotaModel.modelName,
    collectionName: COLLECTIONS.DAILY_QUOTAS,
    getDeclaredIndexes: () => dailyQuotaSchema.indexes(),
  },
  {
    modelName: ActorModel.modelName,
    collectionName: COLLECTIONS.ACTORS,
    getDeclaredIndexes: () => actorSchema.indexes(),
  },
  {
    modelName: AbuseSignalModel.modelName,
    collectionName: COLLECTIONS.ABUSE_SIGNALS,
    getDeclaredIndexes: () => abuseSignalSchema.indexes(),
  },
  {
    modelName: GeoCacheModel.modelName,
    collectionName: COLLECTIONS.GEO_CACHE,
    getDeclaredIndexes: () => geoCacheSchema.indexes(),
  },
  {
    modelName: AdminUserModel.modelName,
    collectionName: COLLECTIONS.ADMIN_USERS,
    getDeclaredIndexes: () => adminUserSchema.indexes(),
  },
  {
    modelName: AdminSessionModel.modelName,
    collectionName: COLLECTIONS.ADMIN_SESSIONS,
    getDeclaredIndexes: () => adminSessionSchema.indexes(),
  },
  {
    modelName: AuditLogModel.modelName,
    collectionName: COLLECTIONS.AUDIT_LOGS,
    getDeclaredIndexes: () => auditLogSchema.indexes(),
  },
  {
    modelName: SettingModel.modelName,
    collectionName: COLLECTIONS.SETTINGS,
    getDeclaredIndexes: () => settingSchema.indexes(),
  },
];
