import { describe, expect, it } from 'vitest';
import * as backendConstants from '../../src/constants/index.js';

/**
 * Backend-owned PRD v1.0 Final (§7 & §10.2) API contract fixture.
 * Keeps backend tests self-contained without importing root ../shared/*.
 */
const PRD_CONTRACT_CONSTANTS = {
  CATEGORIES: [
    'road_accident',
    'traffic_violation',
    'police_misconduct',
    'infrastructure',
    'public_safety',
    'other',
  ],
  FLAG_REASONS: [
    'spam',
    'fake',
    'misleading',
    'inappropriate',
    'irrelevant',
  ],
  COMMENT_TYPES: ['info', 'correction', 'experience'],
  VOTE_TYPES: ['support', 'dispute'],
  INCIDENT_STATUSES: ['published', 'hidden', 'deleted'],
  MODERATION_OUTCOMES: [
    'content_rule',
    'threats',
    'personal_data',
    'harassment',
    'spam',
    'off_topic',
    'duplicate',
    'other',
  ],
  ACTOR_RESTRICTION_SCOPES: ['post', 'comment', 'vote'],
  ERROR_CODES: {
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
  },
  RATE: {
    INCIDENTS_PER_ACTOR_24H: 5,
    COMMENTS_PER_ACTOR_PER_DAY: 5,
    COMMENT_COOLDOWN_SEC: 30,
    COMMENTS_PER_IP_PER_DAY_SOFT: 30,
    VOTE_ACTIONS_PER_ACTOR_PER_HOUR: 30,
    FLAG_ACTIONS_PER_ACTOR_PER_DAY: 20,
    TRACK_FAILS_BEFORE_LOCK: 5,
    TRACK_LOCK_MINUTES: 15,
  },
  EDIT: {
    WINDOW_MINUTES: 15,
    MAX_EDITS: 3,
    MAX_CHANGE_RATIO: 0.3,
    COMMENT_SELF_DELETE_MINUTES: 15,
  },
  PAGING: {
    DEFAULT: 20,
    MAP_MAX: 500,
    NEAREST_MAX: 100,
  },
  SEARCH: {
    DEFAULT_RADIUS_KM: 5,
    MAX_RADIUS_KM: 50,
  },
  TIMEZONE: 'Asia/Dhaka',
  TRACKING_ID_PATTERN: /^MD-[0-9A-HJKMNP-TV-Z]{8}$/,
  LIMITS: {
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
  },
} as const;

describe('backend constants synchronization with PRD contract', () => {
  it('keeps categories, limits, rates, edit rules, and error codes identical', () => {
    expect(PRD_CONTRACT_CONSTANTS.CATEGORIES).toEqual(backendConstants.CATEGORIES);
    expect(PRD_CONTRACT_CONSTANTS.FLAG_REASONS).toEqual(backendConstants.FLAG_REASONS);
    expect(PRD_CONTRACT_CONSTANTS.COMMENT_TYPES).toEqual(backendConstants.COMMENT_TYPES);
    expect(PRD_CONTRACT_CONSTANTS.VOTE_TYPES).toEqual(backendConstants.VOTE_TYPES);
    expect(PRD_CONTRACT_CONSTANTS.INCIDENT_STATUSES).toEqual(
      backendConstants.INCIDENT_STATUSES,
    );
    expect(PRD_CONTRACT_CONSTANTS.MODERATION_OUTCOMES).toEqual(
      backendConstants.MODERATION_OUTCOMES,
    );
    expect(PRD_CONTRACT_CONSTANTS.ACTOR_RESTRICTION_SCOPES).toEqual(
      backendConstants.ACTOR_RESTRICTION_SCOPES,
    );
    expect(PRD_CONTRACT_CONSTANTS.ERROR_CODES).toEqual(backendConstants.ERROR_CODES);
    expect(PRD_CONTRACT_CONSTANTS.RATE).toEqual(backendConstants.RATE);
    expect(PRD_CONTRACT_CONSTANTS.EDIT).toEqual(backendConstants.EDIT);
    expect(PRD_CONTRACT_CONSTANTS.PAGING).toEqual(backendConstants.PAGING);
    expect(PRD_CONTRACT_CONSTANTS.SEARCH).toEqual(backendConstants.SEARCH);
    expect(PRD_CONTRACT_CONSTANTS.TIMEZONE).toBe(backendConstants.TIMEZONE);
    expect(PRD_CONTRACT_CONSTANTS.TRACKING_ID_PATTERN.source).toBe(
      backendConstants.PATTERNS.TRACKING_ID.source,
    );

    expect(PRD_CONTRACT_CONSTANTS.LIMITS.TITLE).toEqual(backendConstants.LIMITS.TITLE);
    expect(PRD_CONTRACT_CONSTANTS.LIMITS.DESCRIPTION).toEqual(
      backendConstants.LIMITS.DESCRIPTION,
    );
    expect(PRD_CONTRACT_CONSTANTS.LIMITS.COMMENT).toEqual(
      backendConstants.LIMITS.COMMENT,
    );
    expect(PRD_CONTRACT_CONSTANTS.LIMITS.BOUNDS).toEqual(
      backendConstants.LIMITS.BOUNDS,
    );
    expect(PRD_CONTRACT_CONSTANTS.LIMITS.SAFETY_TIP_MAX).toBe(
      backendConstants.LIMITS.SAFETY_TIP_MAX,
    );
    expect(PRD_CONTRACT_CONSTANTS.LIMITS.PLACE_TEXT_MAX).toBe(
      backendConstants.LIMITS.PLACE_TEXT_MAX,
    );
    expect(PRD_CONTRACT_CONSTANTS.LIMITS.FLAG_NOTE_MAX).toBe(
      backendConstants.LIMITS.FLAG_NOTE_MAX,
    );
    expect(PRD_CONTRACT_CONSTANTS.LIMITS.MODERATION_REASON_MAX).toBe(
      backendConstants.LIMITS.MODERATION_REASON_MAX,
    );
    expect(PRD_CONTRACT_CONSTANTS.LIMITS.INCIDENT_MAX_AGE_DAYS).toBe(
      backendConstants.LIMITS.INCIDENT_MAX_AGE_DAYS,
    );
    expect(PRD_CONTRACT_CONSTANTS.LIMITS.COORD_DECIMALS).toBe(
      backendConstants.LIMITS.COORD_DECIMALS,
    );
    expect(PRD_CONTRACT_CONSTANTS.LIMITS.GEO_CACHE_COORD_DECIMALS).toBe(
      backendConstants.LIMITS.GEO_CACHE_COORD_DECIMALS,
    );
    expect(PRD_CONTRACT_CONSTANTS.LIMITS.EXCERPT_MAX_CHARS).toBe(
      backendConstants.LIMITS.EXCERPT_MAX_CHARS,
    );
  });
});

