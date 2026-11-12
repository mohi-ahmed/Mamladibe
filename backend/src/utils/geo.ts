import { LIMITS } from '../constants/index.js';

/**
 * Rounds a coordinate value to the configured decimal precision (5 decimals ~ 1 m).
 */
export function roundCoordinate(value: number): number {
  const factor = 10 ** LIMITS.COORD_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * Validates that a GeoJSON coordinate pair [longitude, latitude] consists of two
 * finite numbers strictly within Bangladesh's configured V1 bounding box.
 */
export function isWithinBangladeshBounds(coordinates: unknown): coordinates is [number, number] {
  if (!Array.isArray(coordinates) || coordinates.length !== 2) {
    return false;
  }

  const [lng, lat] = coordinates as [unknown, unknown];

  if (
    typeof lng !== 'number' ||
    typeof lat !== 'number' ||
    !Number.isFinite(lng) ||
    !Number.isFinite(lat)
  ) {
    return false;
  }

  return (
    lng >= LIMITS.BOUNDS.lngMin &&
    lng <= LIMITS.BOUNDS.lngMax &&
    lat >= LIMITS.BOUNDS.latMin &&
    lat <= LIMITS.BOUNDS.latMax
  );
}

