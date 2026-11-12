import { z } from 'zod';
import {
  CATEGORIES,
  COMMENT_TYPES,
  FLAG_REASONS,
  LIMITS,
  PATTERNS,
  VOTE_TYPES,
} from '../constants/index.js';
import { isWithinBangladeshBounds } from '../utils/geo.js';

export const trackingIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(PATTERNS.TRACKING_ID, 'Invalid tracking ID format.');

export const actorIdSchema = z
  .string()
  .trim()
  .regex(PATTERNS.ACTOR_ID_HEX, 'Invalid actor identifier.');

export const sha256HexSchema = z
  .string()
  .trim()
  .regex(PATTERNS.SHA256_HEX, 'Invalid SHA-256 hex digest.');

export const objectIdHexSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid identifier format.');

export const coordinatesSchema = z
  .object({
    lat: z
      .number()
      .finite()
      .min(LIMITS.BOUNDS.latMin, 'Latitude must be within Bangladesh bounds.')
      .max(LIMITS.BOUNDS.latMax, 'Latitude must be within Bangladesh bounds.'),
    lng: z
      .number()
      .finite()
      .min(LIMITS.BOUNDS.lngMin, 'Longitude must be within Bangladesh bounds.')
      .max(LIMITS.BOUNDS.lngMax, 'Longitude must be within Bangladesh bounds.'),
  })
  .strict();

export const geoJsonPointSchema = z
  .object({
    type: z.literal('Point'),
    coordinates: z
      .tuple([z.number().finite(), z.number().finite()])
      .refine((coords) => isWithinBangladeshBounds(coords), {
        message: 'Coordinates must lie within Bangladesh bounds.',
      }),
  })
  .strict();

export const incidentCategorySchema = z.enum(CATEGORIES);
export const flagReasonSchema = z.enum(FLAG_REASONS);
export const commentTypeSchema = z.enum(COMMENT_TYPES);
export const voteTypeSchema = z.enum(VOTE_TYPES);

