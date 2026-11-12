import { getOptionalEnvValue } from '../config/env.js';
import { GEO_CONFIG, LIMITS } from '../constants/index.js';
import { GeoCacheModel } from '../models/index.js';
import { isWithinBangladeshBounds } from '../utils/geo.js';
import { normalizeContentText } from '../lib/text-rules.js';
import { createLogger } from './logger.js';

const geoLogger = createLogger({ module: 'geocoding' });

export interface ReverseGeoResult {
  fallback: boolean;
  roadName?: string;
  areaName?: string;
  upazila?: string;
  district?: string;
  displayName?: string;
}

export interface PlaceSearchCandidate {
  displayName: string;
  lat: number;
  lng: number;
  areaName?: string;
  district?: string;
}

export interface PlaceSearchResult {
  fallback: boolean;
  items: PlaceSearchCandidate[];
}

export interface GeocodingProviderPort {
  reverseBarikoi(lat: number, lng: number, apiKey: string): Promise<ReverseGeoResult | null>;
  reverseNominatim(lat: number, lng: number): Promise<ReverseGeoResult | null>;
  searchBarikoi(query: string, apiKey: string): Promise<PlaceSearchCandidate[] | null>;
  searchNominatim(query: string): Promise<PlaceSearchCandidate[] | null>;
}

let testProviderOverride: GeocodingProviderPort | null = null;
let lastNominatimRequestAt = 0;

export function setGeocodingProviderForTests(
  provider: GeocodingProviderPort | null,
): void {
  testProviderOverride = provider;
}

function cleanPlaceField(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = normalizeContentText(value).slice(0, LIMITS.PLACE_TEXT_MAX);
  return normalized.length > 0 ? normalized : undefined;
}

async function waitNominatimPolitenessGap(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastNominatimRequestAt;
  if (elapsed < GEO_CONFIG.NOMINATIM_MIN_INTERVAL_MS) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, GEO_CONFIG.NOMINATIM_MIN_INTERVAL_MS - elapsed);
    });
  }
  lastNominatimRequestAt = Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

const defaultProvider: GeocodingProviderPort = {
  async reverseBarikoi(lat, lng, apiKey) {
    const url = new URL('https://barikoi.xyz/v2/api/search/reverse/geocode');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('longitude', String(lng));
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('district', 'true');
    url.searchParams.set('sub_district', 'true');

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(GEO_CONFIG.PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as unknown;
    if (!isRecord(payload)) return null;
    const place = isRecord(payload.place) ? payload.place : payload;
    if (!isRecord(place)) return null;

    const roadName = cleanPlaceField(place.road ?? place.street);
    const areaName = cleanPlaceField(place.area ?? place.address);
    const upazila = cleanPlaceField(place.sub_district ?? place.thana ?? place.upazila);
    const district = cleanPlaceField(place.district ?? place.city);
    const displayName = cleanPlaceField(place.address ?? areaName ?? roadName);

    if (!roadName && !areaName && !district) {
      return null;
    }

    return {
      fallback: false,
      ...(roadName ? { roadName } : {}),
      ...(areaName ? { areaName } : {}),
      ...(upazila ? { upazila } : {}),
      ...(district ? { district } : {}),
      ...(displayName ? { displayName } : {}),
    };
  },

  async reverseNominatim(lat, lng) {
    await waitNominatimPolitenessGap();
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('accept-language', 'en');

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mamladibe/1.0 (civic-road-reporting)',
      },
      signal: AbortSignal.timeout(GEO_CONFIG.PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as unknown;
    if (!isRecord(payload)) return null;
    const addr = isRecord(payload.address) ? payload.address : {};

    const roadName = cleanPlaceField(addr.road ?? addr.pedestrian ?? addr.highway);
    const areaName = cleanPlaceField(
      addr.neighbourhood ?? addr.suburb ?? addr.quarter ?? addr.village ?? addr.town,
    );
    const upazila = cleanPlaceField(addr.county ?? addr.subdistrict);
    const district = cleanPlaceField(addr.state_district ?? addr.city ?? addr.state);
    const displayName = cleanPlaceField(payload.display_name);

    if (!roadName && !areaName && !district && !displayName) {
      return null;
    }

    return {
      fallback: false,
      ...(roadName ? { roadName } : {}),
      ...(areaName ? { areaName } : {}),
      ...(upazila ? { upazila } : {}),
      ...(district ? { district } : {}),
      ...(displayName ? { displayName } : {}),
    };
  },

  async searchBarikoi(query, apiKey) {
    const url = new URL('https://barikoi.xyz/v2/api/search/autocomplete/place');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('q', query);
    url.searchParams.set('city', '');

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(GEO_CONFIG.PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as unknown;
    const rawPlaces = isRecord(payload) && Array.isArray(payload.places)
      ? payload.places
      : [];

    const candidates: PlaceSearchCandidate[] = [];
    for (const item of rawPlaces.slice(0, 8)) {
      if (!isRecord(item)) continue;
      const lat = Number(item.latitude);
      const lng = Number(item.longitude);
      if (!isWithinBangladeshBounds([lng, lat])) continue;

      const displayName = cleanPlaceField(item.address ?? item.area ?? item.city);
      if (!displayName) continue;

      const areaName = cleanPlaceField(item.area);
      const district = cleanPlaceField(item.district ?? item.city);
      candidates.push({
        displayName,
        lat,
        lng,
        ...(areaName ? { areaName } : {}),
        ...(district ? { district } : {}),
      });
    }

    return candidates.length > 0 ? candidates : null;
  },

  async searchNominatim(query) {
    await waitNominatimPolitenessGap();
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('q', query);
    url.searchParams.set('countrycodes', 'bd');
    url.searchParams.set('limit', '6');
    url.searchParams.set('addressdetails', '1');

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mamladibe/1.0 (civic-road-reporting)',
      },
      signal: AbortSignal.timeout(GEO_CONFIG.PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) return null;

    const candidates: PlaceSearchCandidate[] = [];
    for (const item of payload.slice(0, 6)) {
      if (!isRecord(item)) continue;
      const lat = Number(item.lat);
      const lng = Number(item.lon);
      if (!isWithinBangladeshBounds([lng, lat])) continue;

      const displayName = cleanPlaceField(item.display_name);
      if (!displayName) continue;

      const addr = isRecord(item.address) ? item.address : {};
      const areaName = cleanPlaceField(addr.suburb ?? addr.neighbourhood ?? addr.town);
      const district = cleanPlaceField(addr.state_district ?? addr.city ?? addr.state);

      candidates.push({
        displayName,
        lat,
        lng,
        ...(areaName ? { areaName } : {}),
        ...(district ? { district } : {}),
      });
    }

    return candidates;
  },
};

function getProvider(): GeocodingProviderPort {
  return testProviderOverride ?? defaultProvider;
}

function buildReverseCacheKey(lat: number, lng: number): string {
  const factor = 10 ** LIMITS.GEO_CACHE_COORD_DECIMALS;
  const rLat = (Math.round(lat * factor) / factor).toFixed(
    LIMITS.GEO_CACHE_COORD_DECIMALS,
  );
  const rLng = (Math.round(lng * factor) / factor).toFixed(
    LIMITS.GEO_CACHE_COORD_DECIMALS,
  );
  return `rev:${rLat},${rLng}`;
}

function buildSearchCacheKey(query: string): string {
  return `search:${normalizeContentText(query).toLowerCase()}`;
}

export async function reverseGeocodePoint(
  lat: number,
  lng: number,
): Promise<ReverseGeoResult> {
  const cacheKey = buildReverseCacheKey(lat, lng);

  try {
    const cached = await GeoCacheModel.findOne({ key: cacheKey })
      .select('result')
      .lean();
    if (cached && isRecord(cached.result)) {
      return cached.result as unknown as ReverseGeoResult;
    }
  } catch (error) {
    geoLogger.warn(
      { errName: error instanceof Error ? error.name : 'UnknownError' },
      'geo_cache lookup failed for reverse geocode',
    );
  }

  const provider = getProvider();
  const barikoiKey = getOptionalEnvValue('BARIKOI_API_KEY');
  let resolved: ReverseGeoResult | null = null;

  if (barikoiKey) {
    try {
      resolved = await provider.reverseBarikoi(lat, lng, barikoiKey);
    } catch (error) {
      geoLogger.warn(
        { errName: error instanceof Error ? error.name : 'UnknownError' },
        'Barikoi reverse geocode failed; falling back to Nominatim',
      );
    }
  }

  if (!resolved) {
    try {
      resolved = await provider.reverseNominatim(lat, lng);
    } catch (error) {
      geoLogger.warn(
        { errName: error instanceof Error ? error.name : 'UnknownError' },
        'Nominatim reverse geocode failed; returning manual fallback',
      );
    }
  }

  if (!resolved) {
    return { fallback: true };
  }

  try {
    await GeoCacheModel.findOneAndUpdate(
      { key: cacheKey },
      {
        $setOnInsert: {
          key: cacheKey,
          result: resolved as unknown as Record<string, unknown>,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    geoLogger.warn(
      { errName: error instanceof Error ? error.name : 'UnknownError' },
      'Failed to write reverse geocode to geo_cache',
    );
  }

  return resolved;
}

export async function searchBangladeshPlaces(
  query: string,
): Promise<PlaceSearchResult> {
  const normalizedQuery = normalizeContentText(query);
  const cacheKey = buildSearchCacheKey(normalizedQuery);

  try {
    const cached = await GeoCacheModel.findOne({ key: cacheKey })
      .select('result')
      .lean();
    if (cached && isRecord(cached.result) && Array.isArray(cached.result.items)) {
      return {
        fallback: Boolean(cached.result.fallback),
        items: cached.result.items as PlaceSearchCandidate[],
      };
    }
  } catch (error) {
    geoLogger.warn(
      { errName: error instanceof Error ? error.name : 'UnknownError' },
      'geo_cache lookup failed for place search',
    );
  }

  const provider = getProvider();
  const barikoiKey = getOptionalEnvValue('BARIKOI_API_KEY');
  let candidates: PlaceSearchCandidate[] | null = null;

  if (barikoiKey) {
    try {
      candidates = await provider.searchBarikoi(normalizedQuery, barikoiKey);
    } catch (error) {
      geoLogger.warn(
        { errName: error instanceof Error ? error.name : 'UnknownError' },
        'Barikoi place search failed; falling back to Nominatim',
      );
    }
  }

  if (!candidates) {
    try {
      candidates = await provider.searchNominatim(normalizedQuery);
    } catch (error) {
      geoLogger.warn(
        { errName: error instanceof Error ? error.name : 'UnknownError' },
        'Nominatim place search failed',
      );
    }
  }

  if (!candidates) {
    return { fallback: true, items: [] };
  }

  const result: PlaceSearchResult = { fallback: false, items: candidates };

  if (candidates.length > 0) {
    try {
      await GeoCacheModel.findOneAndUpdate(
        { key: cacheKey },
        {
          $setOnInsert: {
            key: cacheKey,
            result: result as unknown as Record<string, unknown>,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      geoLogger.warn(
        { errName: error instanceof Error ? error.name : 'UnknownError' },
        'Failed to write place search to geo_cache',
      );
    }
  }

  return result;
}

