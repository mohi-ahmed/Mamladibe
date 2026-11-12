import type { Types } from 'mongoose';
import type {
  ACTOR_RESTRICTION_SCOPES,
  ADMIN_ROLES,
  ADMIN_SESSION_STAGES,
  CATEGORIES,
  COMMENT_STATUSES,
  COMMENT_TYPES,
  EDIT_AUTHORS,
  ERROR_CODES,
  FLAG_REASONS,
  INCIDENT_SOURCES,
  INCIDENT_STATUSES,
  MODERATION_OUTCOMES,
  QUOTA_KINDS,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
  VOTE_TYPES,
} from '../constants/index.js';

export type IncidentCategory = (typeof CATEGORIES)[number];
export type FlagReason = (typeof FLAG_REASONS)[number];
export type CommentType = (typeof COMMENT_TYPES)[number];
export type VoteType = (typeof VOTE_TYPES)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export type IncidentSource = (typeof INCIDENT_SOURCES)[number];
export type EditAuthor = (typeof EDIT_AUTHORS)[number];
export type CommentStatus = (typeof COMMENT_STATUSES)[number];
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export type QuotaKind = (typeof QUOTA_KINDS)[number];
export type ActorRestrictionScope = (typeof ACTOR_RESTRICTION_SCOPES)[number];
export type AdminRole = (typeof ADMIN_ROLES)[number];
export type AdminSessionStage = (typeof ADMIN_SESSION_STAGES)[number];
export type ModerationOutcome = (typeof MODERATION_OUTCOMES)[number];
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface IGeoPoint {
  type: 'Point';
  coordinates: [number, number];
}

export interface IIncident {
  trackingId: string;
  secretHash?: string;
  title: string;
  description: string;
  category: IncidentCategory;
  incidentAt: Date;
  location: IGeoPoint;
  roadName?: string;
  areaName?: string;
  upazila?: string;
  district?: string;
  safetyTip?: string;
  status: IncidentStatus;
  isEdited: boolean;
  editedAt?: Date;
  editCount: number;
  moderatedEdit: boolean;
  source: IncidentSource;
  actorId?: string;
  contentHash?: string;
  createdAt: Date;
  hiddenAt?: Date;
  deletedAt?: Date;
  purgeAt?: Date;
  moderationOutcome?: ModerationOutcome;
}

export interface IIncidentVersion {
  incidentId: Types.ObjectId;
  version: number;
  title: string;
  description: string;
  safetyTip?: string;
  editedAt: Date;
  editedBy: EditAuthor;
  reason?: string;
}

export interface IComment {
  incidentId: Types.ObjectId;
  actorId: string;
  type: CommentType;
  body: string;
  status: CommentStatus;
  redacted: boolean;
  createdAt: Date;
  hiddenAt?: Date;
  deletedAt?: Date;
  purgeAt?: Date;
}

export interface IVote {
  incidentId: Types.ObjectId;
  actorId: string;
  type: VoteType;
  createdAt: Date;
  updatedAt: Date;
}

export interface IReport {
  targetType: ReportTargetType;
  targetId: Types.ObjectId;
  actorId: string;
  reason: FlagReason;
  note?: string;
  status: ReportStatus;
  resolvedBy?: Types.ObjectId;
  resolvedAt?: Date;
  resolutionNote?: string;
  createdAt: Date;
}

export interface IDailyQuota {
  actorId: string;
  day: string;
  kind: QuotaKind;
  count: number;
  expiresAt: Date;
}

export interface IActorRestriction {
  scope: ActorRestrictionScope[];
  until: Date;
  reason: string;
  setBy: Types.ObjectId;
  setAt?: Date;
}

export interface IActor {
  actorId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  restriction?: IActorRestriction;
  restrictionHistory: IActorRestriction[];
  notes?: string;
}

export interface IAbuseSignal {
  ipHash: string;
  actorId?: string;
  type: string;
  createdAt: Date;
}

export interface IGeoCache {
  key: string;
  result: Record<string, unknown>;
  createdAt: Date;
}

export interface IAdminUser {
  email: string;
  passwordHash: string;
  role: AdminRole;
  totpSecretEnc: string;
  totpEnabled: boolean;
  failedLogins: number;
  lockedUntil?: Date;
  active: boolean;
  createdAt: Date;
  lastLoginAt?: Date;
}

export interface IAdminSession {
  adminId: Types.ObjectId;
  sessionHash: string;
  stage: AdminSessionStage;
  csrfToken: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface IAuditLog {
  adminId: Types.ObjectId;
  action: string;
  targetType?: string;
  targetId?: Types.ObjectId;
  reason?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  createdAt: Date;
}

export interface ISetting {
  key: string;
  value: unknown;
  updatedBy: Types.ObjectId;
  updatedAt: Date;
}

export interface ApiErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface HealthResponse {
  status: 'ok' | 'unavailable';
  database: 'connected' | 'disconnected';
  timestamp: string;
}
