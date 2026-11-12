import type { NextFunction, Request, Response } from 'express';
import { ADMIN } from '../constants/index.js';
import {
  constantTimeEqualUtf8,
  sha256Hex,
} from '../lib/crypto.js';
import { AdminSessionModel, AdminUserModel } from '../models/index.js';
import type { AdminRole, IAdminSession, IAdminUser } from '../types/index.js';
import { forbiddenError, unauthorizedError } from '../utils/errors.js';
import type { Types } from 'mongoose';

export const ADMIN_COOKIE_NAME = 'mdb_admin';
const SESSION_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;
const ADMIN_COOKIE_MAX_AGE_MS = ADMIN.SESSION_ABSOLUTE_HOURS * 60 * 60 * 1000;
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type AdminSessionLean = IAdminSession & { _id: Types.ObjectId };
type AdminUserLean = IAdminUser & { _id: Types.ObjectId };

export function setAdminNoCacheHeadersMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  next();
}

export function setAdminSessionCookie(
  res: Response,
  rawToken: string,
  reqSecure: boolean,
  maxAgeMs = ADMIN_COOKIE_MAX_AGE_MS,
): void {
  res.cookie(ADMIN_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || reqSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: maxAgeMs,
  });
}

export function clearAdminSessionCookie(res: Response, reqSecure: boolean): void {
  res.clearCookie(ADMIN_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || reqSecure,
    sameSite: 'strict',
    path: '/',
  });
}

async function resolveValidSession(req: Request) {
  const cookies =
    req.cookies && typeof req.cookies === 'object'
      ? (req.cookies as Record<string, unknown>)
      : {};
  const rawToken = cookies[ADMIN_COOKIE_NAME];

  if (typeof rawToken !== 'string' || !SESSION_TOKEN_PATTERN.test(rawToken)) {
    throw unauthorizedError('Admin authentication required.');
  }

  const sessionHash = sha256Hex(rawToken);
  const session = (await AdminSessionModel.findOne({ sessionHash })
    .select('+sessionHash')
    .lean()) as AdminSessionLean | null;

  if (!session) {
    throw unauthorizedError('Admin session is invalid or expired.');
  }

  const now = new Date();
  const idleLimitMs = ADMIN.SESSION_IDLE_MINUTES * 60 * 1000;
  const isExpired = session.expiresAt.getTime() <= now.getTime();
  const isIdleExpired = now.getTime() - session.lastSeenAt.getTime() > idleLimitMs;

  if (isExpired || isIdleExpired) {
    await AdminSessionModel.deleteOne({ _id: session._id });
    throw unauthorizedError('Admin session expired. Please sign in again.');
  }

  const admin = (await AdminUserModel.findOne({
    _id: session.adminId,
    active: true,
  }).lean()) as AdminUserLean | null;

  if (!admin) {
    await AdminSessionModel.deleteOne({ _id: session._id });
    throw unauthorizedError('Admin account is inactive or unavailable.');
  }

  return { session, admin, now };
}

export async function requirePending2faSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { session, admin } = await resolveValidSession(req);
    if (session.stage !== 'pending_2fa') {
      clearAdminSessionCookie(res, req.secure);
      next(unauthorizedError('Two-factor verification stage is invalid.'));
      return;
    }

    req.adminSession = {
      adminId: admin._id,
      sessionId: session._id,
      email: admin.email,
      role: admin.role,
      csrfToken: session.csrfToken,
      stage: session.stage,
    };
    next();
  } catch (error) {
    clearAdminSessionCookie(res, req.secure);
    next(error);
  }
}

export async function requireActiveAdminSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { session, admin, now } = await resolveValidSession(req);
    if (session.stage !== 'active') {
      next(unauthorizedError('Two-factor authentication is required.'));
      return;
    }

    await AdminSessionModel.updateOne(
      { _id: session._id },
      { $set: { lastSeenAt: now } },
    );

    req.adminSession = {
      adminId: admin._id,
      sessionId: session._id,
      email: admin.email,
      role: admin.role,
      csrfToken: session.csrfToken,
      stage: session.stage,
    };
    next();
  } catch (error) {
    clearAdminSessionCookie(res, req.secure);
    next(error);
  }
}

export function requireCsrfToken(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!STATE_CHANGING_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const session = req.adminSession;
  if (!session || session.stage !== 'active') {
    next(unauthorizedError('Admin authentication required.'));
    return;
  }

  const suppliedToken = req.header(ADMIN.CSRF_HEADER);
  if (
    !suppliedToken ||
    !constantTimeEqualUtf8(suppliedToken, session.csrfToken)
  ) {
    next(forbiddenError('Invalid or missing CSRF token.'));
    return;
  }

  next();
}

export function requireAdminRole(allowedRoles: readonly AdminRole[]) {
  const allowedSet = new Set<AdminRole>(allowedRoles);
  return (req: Request, _res: Response, next: NextFunction): void => {
    const session = req.adminSession;
    if (!session || session.stage !== 'active') {
      next(unauthorizedError('Admin authentication required.'));
      return;
    }

    if (!allowedSet.has(session.role)) {
      next(forbiddenError('Insufficient permissions for this operation.'));
      return;
    }

    next();
  };
}

export const requireModeratorOrSuper = requireAdminRole(['moderator', 'super']);
export const requireSuperAdmin = requireAdminRole(['super']);

