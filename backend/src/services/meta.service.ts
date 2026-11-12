import { getOptionalEnvValue } from '../config/env.js';
import {
  CATEGORIES,
  COMMENT_TYPES,
  EDIT,
  FLAG_REASONS,
  LIMITS,
  PAGING,
  RATE,
  SEARCH,
  TIMEZONE,
  VOTE_TYPES,
} from '../constants/index.js';

export function getPublicMetaPayload() {
  const turnstileSiteKey =
    getOptionalEnvValue('TURNSTILE_SITE_KEY') ??
    getOptionalEnvValue('VITE_TURNSTILE_SITE_KEY') ??
    null;

  return {
    categories: [...CATEGORIES],
    flagReasons: [...FLAG_REASONS],
    commentTypes: [...COMMENT_TYPES],
    voteTypes: [...VOTE_TYPES],
    limits: LIMITS,
    rate: RATE,
    edit: EDIT,
    paging: PAGING,
    search: SEARCH,
    timezone: TIMEZONE,
    turnstileSiteKey,
    serverTime: new Date().toISOString(),
  };
}

