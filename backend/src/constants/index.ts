/**
 * Confirmed V1 collection names from PRD §9.1 and Database.md §4.
 * Do not add extra collections (e.g. anonymous_sessions, blocks, rate_events).
 */
export const COLLECTIONS = {
  INCIDENTS: 'incidents',
  INCIDENT_VERSIONS: 'incident_versions',
  COMMENTS: 'comments',
  VOTES: 'votes',
  REPORTS: 'reports',
  DAILY_QUOTAS: 'daily_quotas',
  ACTORS: 'actors',
  ABUSE_SIGNALS: 'abuse_signals',
  GEO_CACHE: 'geo_cache',
  ADMIN_USERS: 'admin_users',
  ADMIN_SESSIONS: 'admin_sessions',
  AUDIT_LOGS: 'audit_logs',
  SETTINGS: 'settings',
} as const;

export const LIMITS = {
  TITLE: { min: 5, max: 100 },
  DESCRIPTION: { min: 20, max: 2000 },
  SAFETY_TIP_MAX: 500,
  PLACE_TEXT_MAX: 120,
  COMMENT: { min: 5, max: 500, maxLineBreaks: 5 },
  FLAG_NOTE_MAX: 200,
  MODERATION_REASON_MAX: 500,
  INCIDENT_MAX_AGE_DAYS: 90,
  BOUNDS: { latMin: 20.55, latMax: 26.7, lngMin: 88.0, lngMax: 92.7 },
  COORD_DECIMALS: 5,
  GEO_CACHE_COORD_DECIMALS: 4,
  EXCERPT_MAX_CHARS: 160,
  JSON_BODY_LIMIT: '20kb',
  JSON_BODY_MAX_BYTES: 20 * 1024,
} as const;

export const RATE = {
  INCIDENTS_PER_ACTOR_24H: 5,
  COMMENTS_PER_ACTOR_PER_DAY: 5,
  COMMENT_COOLDOWN_SEC: 30,
  COMMENTS_PER_IP_PER_DAY_SOFT: 30,
  VOTE_ACTIONS_PER_ACTOR_PER_HOUR: 30,
  FLAG_ACTIONS_PER_ACTOR_PER_DAY: 20,
  TRACK_FAILS_BEFORE_LOCK: 5,
  TRACK_LOCK_MINUTES: 15,
} as const;

export const EDIT = {
  WINDOW_MINUTES: 15,
  MAX_EDITS: 3,
  MAX_CHANGE_RATIO: 0.3,
  COMMENT_SELF_DELETE_MINUTES: 15,
} as const;

export const PAGING = {
  DEFAULT: 20,
  MAP_MAX: 500,
  NEAREST_MAX: 100,
} as const;

export const SEARCH = {
  DEFAULT_RADIUS_KM: 5,
  MAX_RADIUS_KM: 50,
} as const;

export const ACTOR_COOKIE = {
  name: 'mdb_actor',
  maxAgeDays: 180,
} as const;

export const ADMIN = {
  SESSION_ABSOLUTE_HOURS: 8,
  SESSION_IDLE_MINUTES: 30,
  LOGIN_FAILS_BEFORE_LOCK: 5,
  LOCK_MINUTES: 15,
  TOTP_SESSION_MAX_FAILS: 5,
  PENDING_2FA_WINDOW_MINUTES: 10,
  PASSWORD_MIN: 12,
  CSRF_HEADER: 'x-csrf-token',
} as const;

export const RETENTION = {
  SOFT_DELETE_DAYS: 30,
  HIDDEN_REVIEW_DAYS: 180,
  ABUSE_SIGNAL_DAYS: 7,
  AUDIT_LOG_YEARS: 2,
  GEO_CACHE_DAYS: 30,
  QUOTA_DOC_DAYS: 3,
} as const;

export const TTL_SECONDS = {
  ABUSE_SIGNALS: RETENTION.ABUSE_SIGNAL_DAYS * 24 * 60 * 60, // 604800 (7 days)
  GEO_CACHE: RETENTION.GEO_CACHE_DAYS * 24 * 60 * 60, // 2592000 (30 days)
  IMMEDIATE_AT_FIELD: 0,
} as const;

export const TIMEZONE = 'Asia/Dhaka';

/**
 * Incident categories from PRD §7 (primary authority).
 * Note: Database.md §5.1 proposed `road_infrastructure` (OD-01); PRD uses `infrastructure`.
 */
export const CATEGORIES = [
  'road_accident',
  'traffic_violation',
  'police_misconduct',
  'infrastructure',
  'public_safety',
  'other',
] as const;

export const FLAG_REASONS = [
  'spam',
  'fake',
  'misleading',
  'inappropriate',
  'irrelevant',
] as const;

export const COMMENT_TYPES = ['info', 'correction', 'experience'] as const;

export const VOTE_TYPES = ['support', 'dispute'] as const;

export const INCIDENT_STATUSES = ['published', 'hidden', 'deleted'] as const;

export const INCIDENT_SOURCES = ['public', 'team'] as const;

export const EDIT_AUTHORS = ['reporter', 'moderator'] as const;

export const COMMENT_STATUSES = ['published', 'hidden', 'deleted'] as const;

export const REPORT_TARGET_TYPES = ['incident', 'comment'] as const;

export const REPORT_STATUSES = ['open', 'actioned', 'dismissed'] as const;

export const QUOTA_KINDS = ['comment'] as const;

export const ACTOR_RESTRICTION_SCOPES = ['post', 'comment', 'vote'] as const;

/**
 * Confirmed two-role admin model (PRD §8.10 & Database.md §5.10).
 * Do not add `admin` unless OD-18 is explicitly approved.
 */
export const ADMIN_ROLES = ['moderator', 'super'] as const;

export const ADMIN_SESSION_STAGES = ['pending_2fa', 'active'] as const;

export const MODERATION_OUTCOMES = [
  'content_rule',
  'threats',
  'personal_data',
  'harassment',
  'spam',
  'off_topic',
  'duplicate',
  'other',
] as const;

export const AUDIT_ACTIONS = [
  'incident.create',
  'incident.edit',
  'incident.hide',
  'incident.unhide',
  'incident.delete',
  'incident.restore',
  'incident.purge',
  'comment.edit',
  'comment.hide',
  'comment.unhide',
  'comment.delete',
  'comment.purge',
  'report.resolve',
  'actor.view',
  'actor.notes', // Approved Phase 2B addition (PRD §11.6 defines actor.view|restrict|unrestrict)
  'actor.restrict',
  'actor.unrestrict',
  'user.create',
  'user.update',
  'user.delete',
  'user.reset2fa',
  'settings.update',
  'auth.login',
  'auth.logout',
  'auth.login_failed',
] as const;

export const ABUSE_SIGNAL_TYPES = [
  'rate_limit_hit',
  'duplicate_incident',
  'captcha_failed',
  'track_lockout',
  'comment_ip_soft_cap',
  'admin_login_failed',
] as const;

export const GEO_CONFIG = {
  PROVIDER_TIMEOUT_MS: 4500,
  NOMINATIM_MIN_INTERVAL_MS: 1100,
  RATE_LIMIT_PER_MIN: 60,
} as const;

export const ADMIN_LOGIN_RATE = {
  ATTEMPTS_PER_IP_WINDOW: 10,
  WINDOW_MINUTES: 15,
} as const;

export const COMMON_ADMIN_PASSWORDS: readonly string[] = [
  'password1234',
  'password123456',
  '123456789012',
  '1234567890123456',
  'admin1234567',
  'qwertyuiop12',
  'mamladibe123',
  'letmein12345',
];

/**
 * Known setting keys from PRD §8.13 and §10.4.
 * Note: Database.md §5.13 proposed camelCase names (OD-25); PRD uses snake_case.
 */
export const SETTING_KEYS = {
  FREEZE_POSTING: 'freeze_posting',
  FREEZE_COMMENTS: 'freeze_comments',
} as const;

/**
 * Standard API error codes from PRD §10.2.
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  DUPLICATE_ACTION: 'DUPLICATE_ACTION',
  LOCKED: 'LOCKED',
  EDIT_WINDOW_CLOSED: 'EDIT_WINDOW_CLOSED',
  EDIT_LIMIT_REACHED: 'EDIT_LIMIT_REACHED',
  CAPTCHA_REQUIRED: 'CAPTCHA_REQUIRED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;

export const PATTERNS = {
  TRACKING_ID: /^MD-[0-9A-HJKMNP-TV-Z]{8}$/,
  ACTOR_ID_HEX: /^[0-9a-f]{32}$/,
  SHA256_HEX: /^[0-9a-f]{64}$/,
  IP_HASH_HEX: /^[0-9a-f]{32,64}$/,
  QUOTA_DAY: /^\d{4}-\d{2}-\d{2}$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  DATABASE_NAME: /^[^/\\. "$*<>:|?]+$/,
  MONGO_URI: /^mongodb(?:\+srv)?:\/\//,
} as const;

