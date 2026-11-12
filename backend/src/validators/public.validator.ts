import { z } from 'zod';
import {
  CATEGORIES,
  LIMITS,
  PAGING,
  SEARCH,
} from '../constants/index.js';
import { isWithinBangladeshBounds } from '../utils/geo.js';
import {
  commentTypeSchema,
  coordinatesSchema,
  flagReasonSchema,
  incidentCategorySchema,
  objectIdHexSchema,
  trackingIdSchema,
  voteTypeSchema,
} from './common.validator.js';

const optionalTrimmedString = (maxLen: number) =>
  z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.string().trim().max(maxLen).optional(),
  );

const nonEmptyQueryValue = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
  z.string().trim().optional(),
);

const queryNumberSchema = (min: number, max: number, label: string) =>
  z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.coerce
      .number({ error: `${label} must be a number` })
      .finite(`${label} must be finite`)
      .min(min, `${label} is out of range`)
      .max(max, `${label} is out of range`),
  );

const queryIntSchema = (min: number, max: number, defaultValue: number) =>
  z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.coerce
      .number()
      .int('limit must be an integer')
      .min(min)
      .max(max)
      .optional()
      .default(defaultValue),
  );

const VALID_CATEGORY_SET = new Set<string>(CATEGORIES);

export const createIncidentBodySchema = z
  .object({
    title: z.string().trim().min(LIMITS.TITLE.min).max(LIMITS.TITLE.max),
    description: z
      .string()
      .trim()
      .min(LIMITS.DESCRIPTION.min)
      .max(LIMITS.DESCRIPTION.max),
    category: incidentCategorySchema,
    incidentAt: z.string().datetime({ offset: true, message: 'incidentAt must be a valid ISO-8601 date' }),
    location: coordinatesSchema,
    roadName: optionalTrimmedString(LIMITS.PLACE_TEXT_MAX),
    areaName: optionalTrimmedString(LIMITS.PLACE_TEXT_MAX),
    upazila: optionalTrimmedString(LIMITS.PLACE_TEXT_MAX),
    district: optionalTrimmedString(LIMITS.PLACE_TEXT_MAX),
    safetyTip: optionalTrimmedString(LIMITS.SAFETY_TIP_MAX),
    captchaToken: optionalTrimmedString(4096),
  })
  .strict();

export const trackingIdParamSchema = z
  .object({
    trackingId: trackingIdSchema,
  })
  .strict();

export const commentIdParamSchema = z
  .object({
    id: objectIdHexSchema,
  })
  .strict();

function parseCommaNumbers(raw: string, expectedLength: number): number[] | null {
  const segments = raw.split(',').map((segment) => segment.trim());
  if (segments.length !== expectedLength || segments.some((segment) => segment.length === 0)) {
    return null;
  }

  const numbers = segments.map(Number);
  if (numbers.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return numbers;
}

const categoryCsvQuery = nonEmptyQueryValue.refine(
  (val) => {
    if (!val) return true;
    const parts = val
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return parts.length > 0 && parts.every((item) => VALID_CATEGORY_SET.has(item));
  },
  { message: 'category contains an unsupported category slug' },
);

export const listIncidentsQuerySchema = z
  .object({
    bbox: nonEmptyQueryValue.refine(
      (val) => {
        if (!val) return true;
        const parts = parseCommaNumbers(val, 4);
        if (!parts) {
          return false;
        }
        const [west, south, east, north] = parts as [number, number, number, number];
        return (
          west >= -180 &&
          east <= 180 &&
          west < east &&
          south >= -90 &&
          north <= 90 &&
          south < north
        );
      },
      { message: 'bbox must be west,south,east,north with valid bounds' },
    ),
    near: nonEmptyQueryValue.refine(
      (val) => {
        if (!val) return true;
        const parts = parseCommaNumbers(val, 2);
        if (!parts) return false;
        const [lat, lng] = parts as [number, number];
        return isWithinBangladeshBounds([lng, lat]);
      },
      { message: 'near must be lat,lng inside Bangladesh bounds' },
    ),
    radiusKm: z
      .preprocess(
        (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
        z.coerce
          .number()
          .finite()
          .positive()
          .max(SEARCH.MAX_RADIUS_KM)
          .optional(),
      ),
    q: optionalTrimmedString(120),
    category: categoryCsvQuery,
    // Support client/src/api/public.ts `?cat=` alias alongside PRD `?category=`.
    cat: categoryCsvQuery,
    from: nonEmptyQueryValue.refine(
      (val) => !val || !Number.isNaN(Date.parse(val)),
      { message: 'from must be a valid ISO date' },
    ),
    to: nonEmptyQueryValue.refine(
      (val) => !val || !Number.isNaN(Date.parse(val)),
      { message: 'to must be a valid ISO date' },
    ),
    district: optionalTrimmedString(LIMITS.PLACE_TEXT_MAX),
    sort: z.enum(['newest', 'oldest', 'nearest']).optional().default('newest'),
    limit: z
      .preprocess(
        (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
        z.coerce.number().int().min(1).max(PAGING.MAP_MAX).optional(),
      ),
    cursor: optionalTrimmedString(256),
  })
  .strict()
  .refine(
    (data) => !(data.sort === 'nearest' && !data.near),
    {
      message: 'sort=nearest requires near=lat,lng',
      path: ['sort'],
    },
  )
  .refine(
    (data) => !(data.sort === 'nearest' && data.cursor !== undefined),
    {
      message: 'cursor is not supported with sort=nearest',
      path: ['cursor'],
    },
  )
  .refine(
    (data) => !(data.category && data.cat && data.category !== data.cat),
    {
      message: 'category and cat query parameters must match when both are provided',
      path: ['category'],
    },
  )
  .transform(({ cat, category, ...rest }) => ({
    ...rest,
    category: category ?? cat,
  }));

export const voteBodySchema = z
  .object({
    type: voteTypeSchema,
  })
  .strict();

export const reportBodySchema = z
  .object({
    reason: flagReasonSchema,
    note: optionalTrimmedString(LIMITS.FLAG_NOTE_MAX),
  })
  .strict();

export const listCommentsQuerySchema = z
  .object({
    limit: queryIntSchema(1, 50, PAGING.DEFAULT),
    cursor: optionalTrimmedString(256),
  })
  .strict();

export const createCommentBodySchema = z
  .object({
    type: commentTypeSchema,
    body: z.string().trim().min(LIMITS.COMMENT.min).max(LIMITS.COMMENT.max),
    captchaToken: optionalTrimmedString(4096),
  })
  .strict();

export const trackBodySchema = z
  .object({
    trackingId: trackingIdSchema,
    secret: z.string().trim().min(1, 'secret is required').max(128),
  })
  .strict();

export const quickEditBodySchema = z
  .object({
    secret: z.string().trim().min(1, 'secret is required').max(128),
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
  })
  .strict()
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.safetyTip !== undefined,
    { message: 'Provide at least one editable field (title, description, or safetyTip).' },
  );

export const geoReverseQuerySchema = z
  .object({
    lat: queryNumberSchema(LIMITS.BOUNDS.latMin, LIMITS.BOUNDS.latMax, 'lat'),
    lng: queryNumberSchema(LIMITS.BOUNDS.lngMin, LIMITS.BOUNDS.lngMax, 'lng'),
  })
  .strict();

export const geoSearchQuerySchema = z
  .object({
    q: z.string().trim().min(2, 'Search query must be at least 2 characters').max(120),
  })
  .strict();

export type CreateIncidentInput = z.infer<typeof createIncidentBodySchema>;
export type ListIncidentsQuery = z.infer<typeof listIncidentsQuerySchema>;
export type CreateCommentInput = z.infer<typeof createCommentBodySchema>;
export type QuickEditInput = z.infer<typeof quickEditBodySchema>;

