import { z } from 'zod';
import {
  ACTOR_RESTRICTION_SCOPES,
  ADMIN,
  ADMIN_ROLES,
  CATEGORIES,
  COMMENT_STATUSES,
  COMMENT_TYPES,
  INCIDENT_SOURCES,
  INCIDENT_STATUSES,
  LIMITS,
  MODERATION_OUTCOMES,
  PATTERNS,
  PAGING,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
} from '../constants/index.js';
import { coordinatesSchema, objectIdHexSchema } from './common.validator.js';

const optionalTrimmedString = (maxLen: number) =>
  z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.string().trim().max(maxLen).optional(),
  );

const nonEmptyQueryValue = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
  z.string().trim().optional(),
);

const queryIntSchema = (min: number, max: number, defaultValue: number) =>
  z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.coerce.number().int().min(min).max(max).optional().default(defaultValue),
  );

const queryBoolSchema = z.preprocess((val) => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    if (val.toLowerCase() === 'true' || val === '1') return true;
    if (val.toLowerCase() === 'false' || val === '0') return false;
  }
  return undefined;
}, z.boolean().optional());

export const moderationReasonSchema = z
  .string()
  .trim()
  .min(1, 'A moderation reason is required.')
  .max(LIMITS.MODERATION_REASON_MAX);

export const moderationOutcomeSchema = z.enum(MODERATION_OUTCOMES);

export const objectIdParamSchema = z
  .object({
    id: objectIdHexSchema,
  })
  .strict();

export const adminIncidentIdParamSchema = z
  .object({
    id: z
      .string()
      .trim()
      .refine(
        (val) =>
          /^[0-9a-fA-F]{24}$/.test(val) ||
          PATTERNS.TRACKING_ID.test(val.toUpperCase()),
        'Invalid incident identifier.',
      ),
  })
  .strict();

const HEX_ACTOR_LOOKUP_RE = /^[0-9a-f]{8,32}$/i;
const HEX_EXACT_OR_OBJECT_ID_RE = /^(?:[0-9a-f]{24}|[0-9a-f]{32})$/i;

export const adminActorIdParamSchema = z
  .object({
    id: z
      .string()
      .trim()
      .transform((val) =>
        HEX_ACTOR_LOOKUP_RE.test(val) ? val.toLowerCase() : val.toUpperCase(),
      )
      .refine(
        (val) =>
          HEX_ACTOR_LOOKUP_RE.test(val) || PATTERNS.TRACKING_ID.test(val),
        'Invalid actor identifier. Provide an actor ID, 8+ hex prefix, record ID, or tracking ID.',
      ),
  })
  .strict();

export const adminActorExactIdParamSchema = z
  .object({
    id: z
      .string()
      .trim()
      .transform((val) => val.toLowerCase())
      .refine(
        (val) => HEX_EXACT_OR_OBJECT_ID_RE.test(val),
        'Invalid actor ID format.',
      ),
  })
  .strict();

export const adminLoginBodySchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Valid email is required.').max(254),
    password: z.string().min(1, 'Password is required.').max(256),
  })
  .strict();

export const adminVerify2faBodySchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Verification code must be 6 digits.'),
  })
  .strict();

const optionalActorIdPrefixQuery = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
  z
    .string()
    .trim()
    .regex(
      /^[0-9a-f]{1,32}$/i,
      'actorId filter must be 1 to 32 hexadecimal characters.',
    )
    .transform((val) => val.toLowerCase())
    .optional(),
);

export const adminListIncidentsQuerySchema = z
  .object({
    status: z.enum(INCIDENT_STATUSES).optional(),
    category: z.enum(CATEGORIES).optional(),
    source: z.enum(INCIDENT_SOURCES).optional(),
    district: optionalTrimmedString(LIMITS.PLACE_TEXT_MAX),
    trackingId: nonEmptyQueryValue,
    actorId: optionalActorIdPrefixQuery,
    from: nonEmptyQueryValue.refine(
      (val) => !val || !Number.isNaN(Date.parse(val)),
      'from must be a valid ISO date.',
    ),
    to: nonEmptyQueryValue.refine(
      (val) => !val || !Number.isNaN(Date.parse(val)),
      'to must be a valid ISO date.',
    ),
    limit: queryIntSchema(1, 100, PAGING.DEFAULT),
    cursor: optionalTrimmedString(256),
  })
  .strict();

export const adminCreateIncidentBodySchema = z
  .object({
    title: z.string().trim().min(LIMITS.TITLE.min).max(LIMITS.TITLE.max),
    description: z
      .string()
      .trim()
      .min(LIMITS.DESCRIPTION.min)
      .max(LIMITS.DESCRIPTION.max),
    category: z.enum(CATEGORIES),
    incidentAt: z
      .string()
      .datetime({ offset: true, message: 'incidentAt must be a valid ISO-8601 date' }),
    location: coordinatesSchema,
    roadName: optionalTrimmedString(LIMITS.PLACE_TEXT_MAX),
    areaName: optionalTrimmedString(LIMITS.PLACE_TEXT_MAX),
    upazila: optionalTrimmedString(LIMITS.PLACE_TEXT_MAX),
    district: optionalTrimmedString(LIMITS.PLACE_TEXT_MAX),
    safetyTip: optionalTrimmedString(LIMITS.SAFETY_TIP_MAX),
    reason: optionalTrimmedString(LIMITS.MODERATION_REASON_MAX),
  })
  .strict();

export const adminEditIncidentBodySchema = z
  .object({
    title: z.string().trim().min(LIMITS.TITLE.min).max(LIMITS.TITLE.max).optional(),
    description: z
      .string()
      .trim()
      .min(LIMITS.DESCRIPTION.min)
      .max(LIMITS.DESCRIPTION.max)
      .optional(),
    safetyTip: z
      .string()
      .trim()
      .max(LIMITS.SAFETY_TIP_MAX)
      .nullable()
      .optional(),
    category: z.enum(CATEGORIES).optional(),
    outcome: moderationOutcomeSchema.optional(),
    reason: moderationReasonSchema,
  })
  .strict()
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.safetyTip !== undefined ||
      data.category !== undefined,
    { message: 'Provide at least one field to update.' },
  );

export const adminReasonActionBodySchema = z
  .object({
    reason: moderationReasonSchema,
    outcome: moderationOutcomeSchema.optional(),
  })
  .strict();

export const adminListCommentsQuerySchema = z
  .object({
    status: z.enum(COMMENT_STATUSES).optional(),
    type: z.enum(COMMENT_TYPES).optional(),
    incidentId: optionalTrimmedString(64),
    trackingId: nonEmptyQueryValue,
    actorId: optionalActorIdPrefixQuery,
    limit: queryIntSchema(1, 100, PAGING.DEFAULT),
    cursor: optionalTrimmedString(256),
  })
  .strict();

export const adminEditCommentBodySchema = z
  .object({
    body: z.string().trim().min(LIMITS.COMMENT.min).max(LIMITS.COMMENT.max),
    reason: moderationReasonSchema,
  })
  .strict();

export const adminListReportsQuerySchema = z
  .object({
    status: z.enum(REPORT_STATUSES).optional().default('open'),
    targetType: z.enum(REPORT_TARGET_TYPES).optional(),
    sort: z.enum(['oldest', 'newest', 'most_flagged']).optional().default('oldest'),
    limit: queryIntSchema(1, 100, PAGING.DEFAULT),
    cursor: optionalTrimmedString(256),
  })
  .strict();

export const adminResolveReportBodySchema = z
  .object({
    outcome: z.enum(['actioned', 'dismissed']),
    note: z.string().trim().min(1, 'Resolution note is required.').max(LIMITS.MODERATION_REASON_MAX),
    resolveAllForTarget: z.boolean().optional(),
  })
  .strict();

export const adminListActorsQuerySchema = z
  .object({
    q: optionalTrimmedString(64),
    restrictedOnly: queryBoolSchema,
    limit: queryIntSchema(1, 100, PAGING.DEFAULT),
    cursor: optionalTrimmedString(256),
  })
  .strict();

export const adminRestrictActorBodySchema = z
  .object({
    scope: z
      .array(z.enum(ACTOR_RESTRICTION_SCOPES))
      .min(1, 'Select at least one restriction scope.')
      .max(ACTOR_RESTRICTION_SCOPES.length),
    days: z.number().int().min(1).max(365),
    reason: moderationReasonSchema,
  })
  .strict();

export const adminActorNotesBodySchema = z
  .object({
    notes: z.string().trim().max(1000).nullable(),
    reason: optionalTrimmedString(LIMITS.MODERATION_REASON_MAX),
  })
  .strict();

export const adminCreateUserBodySchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Valid email is required.').max(254),
    password: z.string().min(ADMIN.PASSWORD_MIN).max(256),
    role: z.enum(ADMIN_ROLES),
    reason: optionalTrimmedString(LIMITS.MODERATION_REASON_MAX),
  })
  .strict();

export const adminUpdateUserBodySchema = z
  .object({
    role: z.enum(ADMIN_ROLES).optional(),
    active: z.boolean().optional(),
    reason: moderationReasonSchema,
  })
  .strict()
  .refine((data) => data.role !== undefined || data.active !== undefined, {
    message: 'Provide role or active status to update.',
  });

export const adminDeleteUserBodySchema = z.preprocess(
  (val) => (val === undefined ? {} : val),
  z
    .object({
      reason: optionalTrimmedString(LIMITS.MODERATION_REASON_MAX),
    })
    .strict(),
);

export const adminReset2faBodySchema = z
  .object({
    reason: moderationReasonSchema,
  })
  .strict();

export const adminListAuditQuerySchema = z
  .object({
    adminId: optionalTrimmedString(64),
    targetType: optionalTrimmedString(64),
    targetId: optionalTrimmedString(64),
    action: optionalTrimmedString(64),
    from: nonEmptyQueryValue.refine(
      (val) => !val || !Number.isNaN(Date.parse(val)),
      'from must be a valid ISO date.',
    ),
    to: nonEmptyQueryValue.refine(
      (val) => !val || !Number.isNaN(Date.parse(val)),
      'to must be a valid ISO date.',
    ),
    limit: queryIntSchema(1, 100, PAGING.DEFAULT),
    cursor: optionalTrimmedString(256),
  })
  .strict();

export const adminUpdateSettingsBodySchema = z
  .object({
    freeze_posting: z.boolean().optional(),
    freeze_comments: z.boolean().optional(),
    reason: moderationReasonSchema,
  })
  .strict()
  .refine(
    (data) =>
      data.freeze_posting !== undefined || data.freeze_comments !== undefined,
    { message: 'Provide freeze_posting or freeze_comments to update.' },
  );

export type AdminListIncidentsQuery = z.infer<typeof adminListIncidentsQuerySchema>;
export type AdminCreateIncidentBody = z.infer<typeof adminCreateIncidentBodySchema>;
export type AdminEditIncidentBody = z.infer<typeof adminEditIncidentBodySchema>;
export type AdminListCommentsQuery = z.infer<typeof adminListCommentsQuerySchema>;
export type AdminEditCommentBody = z.infer<typeof adminEditCommentBodySchema>;
export type AdminListReportsQuery = z.infer<typeof adminListReportsQuerySchema>;
export type AdminResolveReportBody = z.infer<typeof adminResolveReportBodySchema>;
export type AdminListActorsQuery = z.infer<typeof adminListActorsQuerySchema>;
export type AdminRestrictActorBody = z.infer<typeof adminRestrictActorBodySchema>;
export type AdminActorNotesBody = z.infer<typeof adminActorNotesBodySchema>;
export type AdminCreateUserBody = z.infer<typeof adminCreateUserBodySchema>;
export type AdminUpdateUserBody = z.infer<typeof adminUpdateUserBodySchema>;
export type AdminDeleteUserBody = z.infer<typeof adminDeleteUserBodySchema>;
export type AdminListAuditQuery = z.infer<typeof adminListAuditQuerySchema>;
export type AdminUpdateSettingsBody = z.infer<typeof adminUpdateSettingsBodySchema>;
