import type { NextFunction, Request, Response } from 'express';
import { getOptionalEnvValue } from '../config/env.js';
import { ACTOR_COOKIE } from '../constants/index.js';
import {
  computeActorId,
  computeIpHash,
  extractClientIp,
  generateBrowserToken,
  isValidBrowserToken,
} from '../lib/crypto.js';
import { internalError } from '../utils/errors.js';

const ACTOR_COOKIE_MAX_AGE_MS =
  ACTOR_COOKIE.maxAgeDays * 24 * 60 * 60 * 1000;

function getCookieRecord(req: Request): Record<string, unknown> {
  if (req.cookies && typeof req.cookies === 'object') {
    return req.cookies as Record<string, unknown>;
  }
  return {};
}

export function resolveOptionalActorId(req: Request): string | undefined {
  const secret = getOptionalEnvValue('ACTOR_HMAC_SECRET');
  if (!secret) {
    return undefined;
  }

  const rawToken = getCookieRecord(req)[ACTOR_COOKIE.name];
  if (!isValidBrowserToken(rawToken)) {
    return undefined;
  }

  return computeActorId(rawToken, secret);
}

export function attachIpHashIfConfigured(req: Request): string | undefined {
  if (req.ipHash) {
    return req.ipHash;
  }

  const ipSecret = getOptionalEnvValue('IP_HMAC_SECRET');
  if (!ipSecret) {
    return undefined;
  }

  const ip = extractClientIp(req);
  req.ipHash = computeIpHash(ip, ipSecret);
  return req.ipHash;
}

export function requireActorIpHash(req: Request): string {
  const existing = attachIpHashIfConfigured(req);
  if (!existing) {
    throw internalError('Server IP hashing secret is not configured.', 500);
  }
  return existing;
}

/**
 * Ensures the caller holds a valid `mdb_actor` cookie (256-bit random base64url)
 * and sets `req.actorId` without touching MongoDB on read requests (PRD §9.1).
 */
export function actorMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const actorSecret = getOptionalEnvValue('ACTOR_HMAC_SECRET');
  if (!actorSecret) {
    req.log?.error({}, 'ACTOR_HMAC_SECRET is not configured');
    next(internalError('Server actor secret is not configured.', 500));
    return;
  }

  const cookies = getCookieRecord(req);
  const existingToken = cookies[ACTOR_COOKIE.name];
  const token = isValidBrowserToken(existingToken)
    ? existingToken
    : generateBrowserToken();

  const isSecureContext =
    process.env.NODE_ENV === 'production' || req.secure;

  // Refresh the cookie max-age on every request per PRD §9.1
  res.cookie(ACTOR_COOKIE.name, token, {
    httpOnly: true,
    secure: isSecureContext,
    sameSite: 'lax',
    path: '/',
    maxAge: ACTOR_COOKIE_MAX_AGE_MS,
  });

  req.actorId = computeActorId(token, actorSecret);
  attachIpHashIfConfigured(req);
  next();
}

