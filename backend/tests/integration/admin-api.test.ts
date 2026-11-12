import type { AddressInfo } from 'node:net';
import mongoose, { Types } from 'mongoose';
import { generate as generateTotp, generateSecret } from 'otplib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { ADMIN } from '../../src/constants/index.js';
import {
  encryptTotpSecret,
  hashAdminPassword,
  sha256Hex,
} from '../../src/lib/crypto.js';
import { createLogger } from '../../src/lib/logger.js';
import {
  InMemoryRateLimitStore,
  resetDevInMemoryRateLimitStore,
  setRateLimitStoreForTests,
} from '../../src/lib/ratelimit.js';
import {
  AbuseSignalModel,
  ActorModel,
  AdminSessionModel,
  AdminUserModel,
  AuditLogModel,
  CommentModel,
  DailyQuotaModel,
  IncidentModel,
  IncidentVersionModel,
  ReportModel,
  SettingModel,
  VoteModel,
} from '../../src/models/index.js';

const ORIGIN = 'http://localhost:5173';
const TOTP_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const IP_SECRET = 'admin-test-ip-secret-at-least-32-chars';

function chain<T>(value: T) {
  return {
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(value),
  };
}

function matchesScalarOrCond(val: unknown, cond: unknown): boolean {
  if (
    cond !== null &&
    typeof cond === 'object' &&
    !(cond instanceof Types.ObjectId) &&
    !(cond instanceof Date)
  ) {
    const ops = cond as Record<string, unknown>;
    let isOpObj = false;
    if ('$exists' in ops) {
      isOpObj = true;
      if (ops.$exists !== (val !== undefined)) return false;
    }
    if ('$lte' in ops) {
      isOpObj = true;
      if (val === undefined || val === null) return false;
      const v = val instanceof Date ? val.getTime() : Number(val);
      const t = ops.$lte instanceof Date ? ops.$lte.getTime() : Number(ops.$lte);
      if (!(v <= t)) return false;
    }
    if ('$lt' in ops) {
      isOpObj = true;
      if (val === undefined || val === null) return false;
      const v = val instanceof Date ? val.getTime() : Number(val);
      const t = ops.$lt instanceof Date ? ops.$lt.getTime() : Number(ops.$lt);
      if (!(v < t)) return false;
    }
    if ('$gte' in ops) {
      isOpObj = true;
      if (val === undefined || val === null) return false;
      const v = val instanceof Date ? val.getTime() : Number(val);
      const t = ops.$gte instanceof Date ? ops.$gte.getTime() : Number(ops.$gte);
      if (!(v >= t)) return false;
    }
    if ('$gt' in ops) {
      isOpObj = true;
      if (val === undefined || val === null) return false;
      const v = val instanceof Date ? val.getTime() : Number(val);
      const t = ops.$gt instanceof Date ? ops.$gt.getTime() : Number(ops.$gt);
      if (!(v > t)) return false;
    }
    if ('$ne' in ops) {
      isOpObj = true;
      if (val instanceof Types.ObjectId && ops.$ne instanceof Types.ObjectId) {
        if (val.equals(ops.$ne)) return false;
      } else if (val === ops.$ne) {
        return false;
      }
    }
    if (isOpObj) return true;
  }

  if (cond === null) {
    return val === null || val === undefined;
  }
  if (val instanceof Types.ObjectId && cond instanceof Types.ObjectId) {
    return val.equals(cond);
  }
  if (val instanceof Date && cond instanceof Date) {
    return val.getTime() === cond.getTime();
  }
  return val === cond;
}

function matchesAdminUserFilter(
  doc: Record<string, unknown>,
  filter: Record<string, unknown> | undefined,
): boolean {
  if (!filter) return true;
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$or') {
      const branches = cond as Array<Record<string, unknown>>;
      if (!branches.some((branch) => matchesAdminUserFilter(doc, branch))) {
        return false;
      }
      continue;
    }
    if (key === '$and') {
      const branches = cond as Array<Record<string, unknown>>;
      if (!branches.every((branch) => matchesAdminUserFilter(doc, branch))) {
        return false;
      }
      continue;
    }
    if (!matchesScalarOrCond(doc[key], cond)) {
      return false;
    }
  }
  return true;
}

type AdminUserUpdateOps = {
  $inc?: Record<string, number>;
  $set?: Record<string, unknown>;
  $unset?: Record<string, unknown>;
};

function applyAdminUserUpdate(
  doc: Record<string, unknown>,
  update: AdminUserUpdateOps,
): void {
  if (update.$inc) {
    for (const [k, delta] of Object.entries(update.$inc)) {
      const current = typeof doc[k] === 'number' ? (doc[k] as number) : 0;
      doc[k] = current + delta;
    }
  }
  if (update.$set) {
    Object.assign(doc, update.$set);
  }
  if (update.$unset) {
    for (const k of Object.keys(update.$unset)) {
      delete doc[k];
    }
  }
}

function mockSingleAdminUserAtomic(adminDoc: Record<string, unknown>) {
  const findOneSpy = vi.spyOn(AdminUserModel, 'findOne').mockImplementation(((
    filter: Record<string, unknown>,
  ) => {
    if (!matchesAdminUserFilter(adminDoc, filter)) {
      return chain(null) as never;
    }
    return chain({ ...adminDoc }) as never;
  }) as never);

  const updateOneSpy = vi.spyOn(AdminUserModel, 'updateOne').mockImplementation((async (
    filter: Record<string, unknown>,
    update: AdminUserUpdateOps,
  ) => {
    if (!matchesAdminUserFilter(adminDoc, filter)) {
      return { matchedCount: 0, modifiedCount: 0 };
    }
    applyAdminUserUpdate(adminDoc, update);
    return { matchedCount: 1, modifiedCount: 1 };
  }) as never);

  const findOneAndUpdateSpy = vi
    .spyOn(AdminUserModel, 'findOneAndUpdate')
    .mockImplementation(((
      filter: Record<string, unknown>,
      update: AdminUserUpdateOps,
      options?: { new?: boolean },
    ) => {
      if (!matchesAdminUserFilter(adminDoc, filter)) {
        return chain(null) as never;
      }
      const before = { ...adminDoc };
      applyAdminUserUpdate(adminDoc, update);
      return chain(options?.new ? { ...adminDoc } : before) as never;
    }) as never);

  return { findOneSpy, updateOneSpy, findOneAndUpdateSpy };
}

function extractAdminCookie(response: Response): string | undefined {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) return undefined;
  const match = /mdb_admin=([^;]+)/.exec(setCookie);
  return match ? `mdb_admin=${match[1]}` : undefined;
}

async function withServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = createApp({
    allowedOrigins: [ORIGIN],
    logger: createLogger({}, 'silent'),
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    return await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe('Admin API integration & RBAC tests (T09)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TOTP_ENC_KEY = TOTP_KEY;
    process.env.IP_HMAC_SECRET = IP_SECRET;
    process.env.NODE_ENV = 'test';

    resetDevInMemoryRateLimitStore();
    setRateLimitStoreForTests(new InMemoryRateLimitStore());

    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);
    vi.spyOn(AbuseSignalModel, 'create').mockResolvedValue({} as never);
    vi.spyOn(AuditLogModel, 'create').mockResolvedValue({} as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    resetDevInMemoryRateLimitStore();
    setRateLimitStoreForTests(null);
  });

  it('blocks unauthenticated requests across protected admin routes (AC-11) with no-store & noindex', async () => {
    await withServer(async (baseUrl) => {
      const checks: Array<{ method: string; path: string; body?: unknown }> = [
        { method: 'GET', path: '/api/v1/admin/auth/me' },
        { method: 'POST', path: '/api/v1/admin/auth/logout' },
        { method: 'GET', path: '/api/v1/admin/dashboard' },
        { method: 'GET', path: '/api/v1/admin/incidents' },
        {
          method: 'DELETE',
          path: '/api/v1/admin/incidents/MD-7K3Q9XTB/permanent',
          body: { reason: 'cleanup' },
        },
        { method: 'GET', path: '/api/v1/admin/comments' },
        { method: 'GET', path: '/api/v1/admin/reports' },
        { method: 'GET', path: '/api/v1/admin/actors' },
        { method: 'GET', path: '/api/v1/admin/users' },
        { method: 'GET', path: '/api/v1/admin/audit' },
        { method: 'GET', path: '/api/v1/admin/settings' },
      ];

      for (const reqSpec of checks) {
        const res = await fetch(`${baseUrl}${reqSpec.path}`, {
          method: reqSpec.method,
          headers: {
            ...(reqSpec.method !== 'GET'
              ? { 'Content-Type': 'application/json', Origin: ORIGIN }
              : {}),
          },
          ...(reqSpec.body ? { body: JSON.stringify(reqSpec.body) } : {}),
        });
        expect(res.status).toBe(401);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(res.headers.get('x-robots-tag')).toBe('noindex');
      }
    });
  });

  it('enforces pending_2fa stage gate (AC-17), TOTP replay lock, CSRF check, and idle timeout', async () => {
    const adminId = new Types.ObjectId();
    const sessionId = new Types.ObjectId();
    const totpSecret = generateSecret();
    const password = 'CorrectHorseBattery99!';
    const passwordHash = await hashAdminPassword(password);
    const adminDoc = {
      _id: adminId,
      email: 'super@mamladibe.org',
      passwordHash,
      role: 'super' as const,
      totpSecretEnc: encryptTotpSecret(totpSecret, TOTP_KEY),
      totpEnabled: false,
      failedLogins: 0,
      active: true,
      createdAt: new Date(),
    };

    const sessions = new Map<string, Record<string, unknown>>();
    const { findOneSpy } = mockSingleAdminUserAtomic(adminDoc);

    vi.spyOn(AdminSessionModel, 'create').mockImplementation((async (
      doc: Record<string, unknown>,
    ) => {
      const record = { ...doc, _id: sessionId };
      sessions.set(String(doc.sessionHash), record);
      return record;
    }) as never);

    vi.spyOn(AdminSessionModel, 'findOne').mockImplementation(((
      filter: { sessionHash?: string },
    ) => chain(sessions.get(filter.sessionHash ?? '') ?? null)) as never);

    vi.spyOn(AdminSessionModel, 'updateOne').mockImplementation((async (
      _filter: unknown,
      update: { $set?: Record<string, unknown> },
    ) => {
      const existing = Array.from(sessions.values())[0];
      if (existing && update.$set) {
        sessions.clear();
        Object.assign(existing, update.$set);
        sessions.set(String(existing.sessionHash), existing);
      }
      return { modifiedCount: 1 };
    }) as never);

    const deleteSessionSpy = vi
      .spyOn(AdminSessionModel, 'deleteOne')
      .mockImplementation((async () => {
        sessions.clear();
        return { deletedCount: 1 };
      }) as never);

    await withServer(async (baseUrl) => {
      // 1. Password login creates pending_2fa session & emits one-time totpSetup
      const loginRes = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({ email: 'super@mamladibe.org', password }),
      });
      expect(loginRes.status).toBe(200);
      const pendingCookie = extractAdminCookie(loginRes);
      expect(pendingCookie).toBeDefined();
      expect(loginRes.headers.get('set-cookie')).toContain('SameSite=Strict');
      const loginJson = (await loginRes.json()) as {
        pending2fa: boolean;
        requires2faSetup: boolean;
        totpSetup?: { qrDataUrl: string };
      };
      expect(loginJson.pending2fa).toBe(true);
      expect(loginJson.requires2faSetup).toBe(true);
      expect(loginJson.totpSetup?.qrDataUrl).toContain('data:image/png;base64');

      // 2. pending_2fa cookie MUST be rejected from active routes (AC-17)
      const blockedDash = await fetch(`${baseUrl}/api/v1/admin/dashboard`, {
        headers: { Cookie: pendingCookie! },
      });
      expect(blockedDash.status).toBe(401);

      const blockedUsers = await fetch(`${baseUrl}/api/v1/admin/users`, {
        headers: { Cookie: pendingCookie! },
      });
      expect(blockedUsers.status).toBe(401);

      // 3. Complete 2FA verification -> activates & rotates cookie
      const validCode = await generateTotp({ secret: totpSecret });
      const verifyRes = await fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: pendingCookie!,
        },
        body: JSON.stringify({ code: validCode }),
      });
      expect(verifyRes.status).toBe(200);
      const activeCookie = extractAdminCookie(verifyRes);
      expect(activeCookie).toBeDefined();
      expect(activeCookie).not.toBe(pendingCookie);
      const verifyJson = (await verifyRes.json()) as {
        admin: { email: string; role: string };
        csrfToken: string;
      };
      expect(verifyJson.admin.role).toBe('super');
      expect(verifyJson.csrfToken.length).toBeGreaterThan(20);

      // 4. Reusing same TOTP code on another login is rejected (replay guard)
      const secondLoginRes = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({ email: 'super@mamladibe.org', password }),
      });
      expect(secondLoginRes.status).toBe(200);
      const secondLoginJson = (await secondLoginRes.json()) as {
        requires2faSetup: boolean;
        totpSetup?: unknown;
      };
      expect(secondLoginJson.requires2faSetup).toBe(false);
      expect(secondLoginJson.totpSetup).toBeUndefined();

      const secondCookie = extractAdminCookie(secondLoginRes)!;
      const replayRes = await fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: secondCookie,
        },
        body: JSON.stringify({ code: validCode }),
      });
      expect(replayRes.status).toBe(401);

      // 5. CSRF enforcement on active state-changing route (logout without x-csrf-token -> 403)
      // Restore active session for the token check
      const rawToken = 'f'.repeat(64);
      const csrfToken = 'csrf-secret-token-value-123';
      sessions.clear();
      sessions.set(sha256Hex(rawToken), {
        _id: sessionId,
        adminId,
        sessionHash: sha256Hex(rawToken),
        stage: 'active',
        csrfToken,
        createdAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      });

      const noCsrfRes = await fetch(`${baseUrl}/api/v1/admin/auth/logout`, {
        method: 'POST',
        headers: {
          Origin: ORIGIN,
          Cookie: `mdb_admin=${rawToken}`,
        },
      });
      expect(noCsrfRes.status).toBe(403);

      // 6. Idle timeout > 30 min terminates session & rejects with 401
      sessions.set(sha256Hex(rawToken), {
        _id: sessionId,
        adminId,
        sessionHash: sha256Hex(rawToken),
        stage: 'active',
        csrfToken,
        createdAt: new Date(Date.now() - 40 * 60_000),
        lastSeenAt: new Date(Date.now() - (ADMIN.SESSION_IDLE_MINUTES + 1) * 60_000),
        expiresAt: new Date(Date.now() + 3600_000),
      });

      const idleExpiredRes = await fetch(`${baseUrl}/api/v1/admin/auth/me`, {
        headers: { Cookie: `mdb_admin=${rawToken}` },
      });
      expect(idleExpiredRes.status).toBe(401);
      expect(deleteSessionSpy).toHaveBeenCalled();
    });
  });

  it('enforces RBAC: moderator forbidden (403) on Super-Admin routes and sees only own audit entries', async () => {
    const modId = new Types.ObjectId();
    const sessionId = new Types.ObjectId();
    const rawToken = 'e'.repeat(64);
    const csrfToken = 'mod-csrf-token-value';

    vi.spyOn(AdminSessionModel, 'findOne').mockReturnValue(
      chain({
        _id: sessionId,
        adminId: modId,
        sessionHash: sha256Hex(rawToken),
        stage: 'active',
        csrfToken,
        createdAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      }) as never,
    );
    vi.spyOn(AdminSessionModel, 'updateOne').mockResolvedValue({ modifiedCount: 1 } as never);
    vi.spyOn(AdminUserModel, 'findOne').mockReturnValue(
      chain({
        _id: modId,
        email: 'mod@mamladibe.org',
        role: 'moderator',
        active: true,
      }) as never,
    );

    const auditFindSpy = vi
      .spyOn(AuditLogModel, 'find')
      .mockReturnValue(chain([]) as never);
    vi.spyOn(AdminUserModel, 'find').mockReturnValue(chain([]) as never);

    await withServer(async (baseUrl) => {
      const headers = {
        Cookie: `mdb_admin=${rawToken}`,
        Origin: ORIGIN,
        'x-csrf-token': csrfToken,
        'Content-Type': 'application/json',
      };

      const superOnlyRoutes: Array<{ method: string; path: string; body?: unknown }> = [
        {
          method: 'DELETE',
          path: '/api/v1/admin/incidents/MD-7K3Q9XTB/permanent',
          body: { reason: 'permanent removal' },
        },
        {
          method: 'DELETE',
          path: `/api/v1/admin/comments/${new Types.ObjectId().toString()}/permanent`,
          body: { reason: 'permanent removal' },
        },
        { method: 'GET', path: '/api/v1/admin/users' },
        { method: 'GET', path: '/api/v1/admin/settings' },
        {
          method: 'PATCH',
          path: '/api/v1/admin/settings',
          body: { freeze_posting: true, reason: 'emergency freeze' },
        },
      ];

      for (const route of superOnlyRoutes) {
        const res = await fetch(`${baseUrl}${route.path}`, {
          method: route.method,
          headers,
          ...(route.body ? { body: JSON.stringify(route.body) } : {}),
        });
        expect(res.status).toBe(403);
      }

      // Moderator audit query always locks adminId to caller's own ID even if another adminId is queried
      const otherAdminId = new Types.ObjectId().toString();
      const auditRes = await fetch(
        `${baseUrl}/api/v1/admin/audit?adminId=${otherAdminId}`,
        { headers: { Cookie: `mdb_admin=${rawToken}` } },
      );
      expect(auditRes.status).toBe(200);
      expect(auditFindSpy).toHaveBeenCalledWith(
        expect.objectContaining({ adminId: modId }),
      );
    });
  });

  it('requires reasons, writes audit logs on moderation + actor.view (AC-12), and performs cascade permanent delete', async () => {
    const superId = new Types.ObjectId();
    const sessionId = new Types.ObjectId();
    const incidentId = new Types.ObjectId();
    const actorDbId = new Types.ObjectId();
    const commentId = new Types.ObjectId();
    const rawToken = 'd'.repeat(64);
    const csrfToken = 'super-csrf-token-value';
    const actorId = 'a'.repeat(32);

    vi.spyOn(AdminSessionModel, 'findOne').mockReturnValue(
      chain({
        _id: sessionId,
        adminId: superId,
        sessionHash: sha256Hex(rawToken),
        stage: 'active',
        csrfToken,
        createdAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      }) as never,
    );
    vi.spyOn(AdminSessionModel, 'updateOne').mockResolvedValue({ modifiedCount: 1 } as never);
    vi.spyOn(AdminUserModel, 'findOne').mockReturnValue(
      chain({
        _id: superId,
        email: 'super@mamladibe.org',
        role: 'super',
        active: true,
      }) as never,
    );

    const existingIncident = {
      _id: incidentId,
      trackingId: 'MD-7K3Q9XTB',
      actorId,
      secretHash: 'secret-never-shown',
      title: 'Original incident title with minor typo',
      description: 'Original description with more than twenty valid characters here.',
      category: 'infrastructure' as const,
      incidentAt: new Date(),
      location: { type: 'Point' as const, coordinates: [90.41, 23.81] as [number, number] },
      status: 'published' as const,
      source: 'public' as const,
      isEdited: false,
      editCount: 0,
      moderatedEdit: false,
      createdAt: new Date(),
    };

    const auditCreateSpy = vi
      .spyOn(AuditLogModel, 'create')
      .mockResolvedValue({} as never);

    vi.spyOn(IncidentModel, 'findOne').mockReturnValue(chain(existingIncident) as never);
    vi.spyOn(IncidentVersionModel, 'findOne').mockReturnValue(chain(null) as never);
    const versionCreateSpy = vi
      .spyOn(IncidentVersionModel, 'create')
      .mockResolvedValue({} as never);
    vi.spyOn(IncidentModel, 'findOneAndUpdate').mockReturnValue(
      chain({
        ...existingIncident,
        title: 'Redacted safe title by moderator',
        isEdited: true,
        moderatedEdit: true,
        editedAt: new Date(),
      }) as never,
    );

    await withServer(async (baseUrl) => {
      const headers = {
        Cookie: `mdb_admin=${rawToken}`,
        Origin: ORIGIN,
        'x-csrf-token': csrfToken,
        'Content-Type': 'application/json',
      };

      // 1. Reason is mandatory on moderation actions
      const missingReason = await fetch(
        `${baseUrl}/api/v1/admin/incidents/MD-7K3Q9XTB/hide`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({}),
        },
      );
      expect(missingReason.status).toBe(400);

      // 2. Moderation edit sets moderatedEdit, saves IncidentVersion, writes audit log
      const modEditRes = await fetch(
        `${baseUrl}/api/v1/admin/incidents/MD-7K3Q9XTB`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            title: 'Redacted safe title by moderator',
            reason: 'Removed identifying name from title',
            outcome: 'personal_data',
          }),
        },
      );
      expect(modEditRes.status).toBe(200);
      expect(versionCreateSpy).toHaveBeenCalledOnce();
      expect(auditCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: superId,
          action: 'incident.edit',
          reason: 'Removed identifying name from title',
        }),
      );

      // 3. Viewing actor profile writes actor.view audit entry & never leaks ipHash
      vi.spyOn(ActorModel, 'findOne').mockReturnValueOnce(
        chain({
          _id: actorDbId,
          actorId,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          restrictionHistory: [],
        }) as never,
      );
      vi.spyOn(IncidentModel, 'find').mockReturnValueOnce(chain([]) as never);
      vi.spyOn(CommentModel, 'find').mockReturnValueOnce(chain([]) as never);
      vi.spyOn(VoteModel, 'countDocuments').mockResolvedValueOnce(2);
      vi.spyOn(ReportModel, 'countDocuments').mockResolvedValueOnce(1);
      vi.spyOn(DailyQuotaModel, 'findOne').mockReturnValueOnce(
        chain({ count: 3 }) as never,
      );
      vi.spyOn(AbuseSignalModel, 'aggregate').mockResolvedValueOnce([
        { _id: 'rate_limit_hit', count: 2 },
      ] as never);

      const actorRes = await fetch(`${baseUrl}/api/v1/admin/actors/${actorId}`, {
        headers: { Cookie: `mdb_admin=${rawToken}` },
      });
      expect(actorRes.status).toBe(200);
      const actorBody = (await actorRes.json()) as {
        actor: { actorIdShort: string };
        activity: { commentsUsedToday: number; voteCount: number };
      };
      expect(actorBody.actor.actorIdShort).toBe(actorId.slice(0, 8));
      expect(actorBody.activity.commentsUsedToday).toBe(3);
      expect(actorBody.activity.voteCount).toBe(2);
      expect(auditCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'actor.view',
          targetType: 'actor',
          targetId: actorDbId,
        }),
      );

      // 4. Super Admin permanent cascade purge deletes all linked collections
      vi.spyOn(CommentModel, 'find').mockReturnValueOnce(
        chain([{ _id: commentId }]) as never,
      );
      const delReportsSpy = vi
        .spyOn(ReportModel, 'deleteMany')
        .mockResolvedValue({ deletedCount: 1 } as never);
      const delVotesSpy = vi
        .spyOn(VoteModel, 'deleteMany')
        .mockResolvedValue({ deletedCount: 2 } as never);
      const delCommentsSpy = vi
        .spyOn(CommentModel, 'deleteMany')
        .mockResolvedValue({ deletedCount: 1 } as never);
      const delVersionsSpy = vi
        .spyOn(IncidentVersionModel, 'deleteMany')
        .mockResolvedValue({ deletedCount: 1 } as never);
      const delIncidentSpy = vi
        .spyOn(IncidentModel, 'deleteOne')
        .mockResolvedValue({ deletedCount: 1 } as never);

      const purgeRes = await fetch(
        `${baseUrl}/api/v1/admin/incidents/MD-7K3Q9XTB/permanent`,
        {
          method: 'DELETE',
          headers,
          body: JSON.stringify({ reason: 'Legal removal request #12' }),
        },
      );
      expect(purgeRes.status).toBe(200);
      expect(await purgeRes.json()).toEqual({
        purged: true,
        trackingId: 'MD-7K3Q9XTB',
        deletedComments: 1,
      });
      expect(delReportsSpy).toHaveBeenCalledTimes(2);
      expect(delVotesSpy).toHaveBeenCalledOnce();
      expect(delCommentsSpy).toHaveBeenCalledOnce();
      expect(delVersionsSpy).toHaveBeenCalledOnce();
      expect(delIncidentSpy).toHaveBeenCalledOnce();
      expect(auditCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'incident.purge',
          reason: 'Legal removal request #12',
        }),
      );

      // 5. Super Admin platform settings toggle writes settings.update audit log
      vi.spyOn(SettingModel, 'find')
        .mockReturnValueOnce(chain([]) as never)
        .mockReturnValueOnce(chain([{ key: 'freeze_posting', value: true }]) as never)
        .mockReturnValueOnce(chain([{ key: 'freeze_posting', value: true }]) as never)
        .mockReturnValueOnce(
          chain([
            {
              key: 'freeze_posting',
              value: true,
              updatedAt: new Date(),
            },
          ]) as never,
        );
      vi.spyOn(SettingModel, 'findOneAndUpdate').mockResolvedValue({} as never);

      const settingsRes = await fetch(`${baseUrl}/api/v1/admin/settings`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          freeze_posting: true,
          reason: 'Spam wave mitigation',
        }),
      });
      expect(settingsRes.status).toBe(200);
      const settingsJson = (await settingsRes.json()) as {
        freeze_posting: boolean;
        freeze_comments: boolean;
      };
      expect(settingsJson.freeze_posting).toBe(true);
      expect(auditCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'settings.update',
          reason: 'Spam wave mitigation',
        }),
      );
    });
  });

  it('locks admin account after 5 wrong password attempts with 423 LOCKED', async () => {
    const adminId = new Types.ObjectId();
    const passwordHash = await hashAdminPassword('VeryStrongPassword!123');
    const adminDoc: {
      _id: Types.ObjectId;
      email: string;
      passwordHash: string;
      role: 'moderator';
      totpSecretEnc: string;
      totpEnabled: boolean;
      failedLogins: number;
      lockedUntil?: Date;
      active: boolean;
    } = {
      _id: adminId,
      email: 'mod@mamladibe.org',
      passwordHash,
      role: 'moderator',
      totpSecretEnc: encryptTotpSecret(generateSecret(), TOTP_KEY),
      totpEnabled: true,
      failedLogins: 0,
      active: true,
    };

    mockSingleAdminUserAtomic(adminDoc);
    const deletePendingSpy = vi
      .spyOn(AdminSessionModel, 'deleteMany')
      .mockResolvedValue({ deletedCount: 0 } as never);

    await withServer(async (baseUrl) => {
      for (let i = 1; i < ADMIN.LOGIN_FAILS_BEFORE_LOCK; i += 1) {
        const res = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
          body: JSON.stringify({
            email: 'mod@mamladibe.org',
            password: 'wrong-password-1234',
          }),
        });
        expect(res.status).toBe(401);
      }

      const fifthAttempt = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({
          email: 'mod@mamladibe.org',
          password: 'wrong-password-1234',
        }),
      });
      expect(fifthAttempt.status).toBe(423);
      expect(
        ((await fifthAttempt.json()) as { error: { code: string } }).error.code,
      ).toBe('LOCKED');
      expect(deletePendingSpy).toHaveBeenCalledWith({
        adminId,
        stage: 'pending_2fa',
      });
    });
  });

  it('Phase 2A regression (BUG-DB-1): hiding incidents/comments unsets purgeAt while soft-delete sets +30d', async () => {
    const modId = new Types.ObjectId();
    const sessionId = new Types.ObjectId();
    const incidentId = new Types.ObjectId();
    const commentId = new Types.ObjectId();
    const actorId32 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const rawToken = 'b'.repeat(64);
    const csrfToken = 'phase2a-db1-csrf-token';

    vi.spyOn(AdminSessionModel, 'findOne').mockReturnValue(
      chain({
        _id: sessionId,
        adminId: modId,
        sessionHash: sha256Hex(rawToken),
        stage: 'active',
        csrfToken,
        createdAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      }) as never,
    );
    vi.spyOn(AdminSessionModel, 'updateOne').mockResolvedValue({ modifiedCount: 1 } as never);
    vi.spyOn(AdminUserModel, 'findOne').mockReturnValue(
      chain({
        _id: modId,
        email: 'mod@mamladibe.org',
        role: 'moderator',
        active: true,
      }) as never,
    );

    const baseIncident = {
      _id: incidentId,
      trackingId: 'MD-7K3Q9XTB',
      actorId: actorId32,
      title: 'Incident title for retention regression check',
      description: 'Detailed description exceeding twenty characters cleanly.',
      category: 'infrastructure' as const,
      incidentAt: new Date(),
      location: { type: 'Point' as const, coordinates: [90.41, 23.81] as [number, number] },
      status: 'published' as const,
      source: 'public' as const,
      isEdited: false,
      editCount: 0,
      moderatedEdit: false,
      createdAt: new Date(),
    };
    const baseComment = {
      _id: commentId,
      incidentId,
      actorId: actorId32,
      type: 'corroboration' as const,
      body: 'Valid comment body for moderation.',
      status: 'published' as const,
      redacted: false,
      createdAt: new Date(),
    };

    const incidentUpdates: Array<{ $set?: Record<string, unknown>; $unset?: Record<string, unknown> }> = [];
    const commentUpdates: Array<{ $set?: Record<string, unknown>; $unset?: Record<string, unknown> }> = [];

    vi.spyOn(IncidentModel, 'findOne').mockReturnValue(chain(baseIncident) as never);
    vi.spyOn(IncidentModel, 'findOneAndUpdate').mockImplementation(((_filter: unknown, update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> }) => {
      incidentUpdates.push(update);
      const nextStatus = (update.$set?.status as string | undefined) ?? 'published';
      return chain({
        ...baseIncident,
        status: nextStatus,
        hiddenAt: update.$set?.hiddenAt as Date | undefined,
        deletedAt: update.$set?.deletedAt as Date | undefined,
        purgeAt: update.$unset?.purgeAt ? undefined : (update.$set?.purgeAt as Date | undefined),
      });
    }) as never);

    vi.spyOn(CommentModel, 'findOne').mockReturnValue(chain(baseComment) as never);
    vi.spyOn(CommentModel, 'findOneAndUpdate').mockImplementation(((_filter: unknown, update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> }) => {
      commentUpdates.push(update);
      const nextStatus = (update.$set?.status as string | undefined) ?? 'published';
      return chain({
        ...baseComment,
        status: nextStatus,
        hiddenAt: update.$set?.hiddenAt as Date | undefined,
        deletedAt: update.$set?.deletedAt as Date | undefined,
        purgeAt: update.$unset?.purgeAt ? undefined : (update.$set?.purgeAt as Date | undefined),
      });
    }) as never);

    await withServer(async (baseUrl) => {
      const headers = {
        Cookie: `mdb_admin=${rawToken}`,
        Origin: ORIGIN,
        'x-csrf-token': csrfToken,
        'Content-Type': 'application/json',
      };

      const hideIncRes = await fetch(`${baseUrl}/api/v1/admin/incidents/MD-7K3Q9XTB/hide`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: 'Moderation review hold' }),
      });
      expect(hideIncRes.status).toBe(200);
      expect(((await hideIncRes.json()) as { incident: { purgeAt: string | null } }).incident.purgeAt).toBeNull();
      expect(incidentUpdates[0]?.$set?.purgeAt).toBeUndefined();
      expect(incidentUpdates[0]?.$unset?.purgeAt).toBe(1);

      const delIncRes = await fetch(`${baseUrl}/api/v1/admin/incidents/MD-7K3Q9XTB`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ reason: 'Soft deleting spam report' }),
      });
      expect(delIncRes.status).toBe(200);
      expect(incidentUpdates[1]?.$set?.purgeAt).toBeInstanceOf(Date);

      const unhideIncRes = await fetch(`${baseUrl}/api/v1/admin/incidents/MD-7K3Q9XTB/unhide`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: 'Cleared after review' }),
      });
      expect(unhideIncRes.status).toBe(200);
      expect(incidentUpdates[2]?.$unset?.purgeAt).toBe(1);

      const restoreIncRes = await fetch(`${baseUrl}/api/v1/admin/incidents/MD-7K3Q9XTB/restore`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: 'Restored mistakenly deleted report' }),
      });
      expect(restoreIncRes.status).toBe(200);
      expect(incidentUpdates[3]?.$unset?.purgeAt).toBe(1);

      const hideComRes = await fetch(`${baseUrl}/api/v1/admin/comments/${commentId.toString()}/hide`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: 'Moderation hold on comment' }),
      });
      expect(hideComRes.status).toBe(200);
      expect(((await hideComRes.json()) as { comment: { purgeAt: string | null } }).comment.purgeAt).toBeNull();
      expect(commentUpdates[0]?.$set?.purgeAt).toBeUndefined();
      expect(commentUpdates[0]?.$unset?.purgeAt).toBe(1);

      const delComRes = await fetch(`${baseUrl}/api/v1/admin/comments/${commentId.toString()}`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ reason: 'Soft deleting spam comment' }),
      });
      expect(delComRes.status).toBe(200);
      expect(commentUpdates[1]?.$set?.purgeAt).toBeInstanceOf(Date);

      const unhideComRes = await fetch(`${baseUrl}/api/v1/admin/comments/${commentId.toString()}/unhide`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: 'Comment restored' }),
      });
      expect(unhideComRes.status).toBe(200);
      expect(commentUpdates[2]?.$unset?.purgeAt).toBe(1);
    });
  });

  it('Phase 2A regression (BUG-SEC-1): scopes dashboard, incident, and comment audit queries to own actions for moderators only', async () => {
    const modId = new Types.ObjectId();
    const superId = new Types.ObjectId();
    const incidentId = new Types.ObjectId();
    const commentId = new Types.ObjectId();
    const modToken = 'c'.repeat(64);
    const superToken = 'd'.repeat(64);
    let currentRole: 'moderator' | 'super' = 'moderator';

    vi.spyOn(AdminSessionModel, 'findOne').mockImplementation(((filter: { sessionHash?: string }) => {
      const adminId = filter.sessionHash === sha256Hex(superToken) ? superId : modId;
      return chain({
        _id: new Types.ObjectId(),
        adminId,
        sessionHash: filter.sessionHash,
        stage: 'active',
        csrfToken: 'csrf',
        createdAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      });
    }) as never);
    vi.spyOn(AdminSessionModel, 'updateOne').mockResolvedValue({ modifiedCount: 1 } as never);
    vi.spyOn(AdminUserModel, 'findOne').mockImplementation((() =>
      chain({
        _id: currentRole === 'super' ? superId : modId,
        email: `${currentRole}@mamladibe.org`,
        role: currentRole,
        active: true,
      })) as never);

    vi.spyOn(IncidentModel, 'countDocuments').mockResolvedValue(1);
    vi.spyOn(ReportModel, 'countDocuments').mockResolvedValue(1);
    vi.spyOn(ActorModel, 'countDocuments').mockResolvedValue(1);
    vi.spyOn(CommentModel, 'countDocuments').mockResolvedValue(1);
    vi.spyOn(IncidentModel, 'findOne').mockReturnValue(
      chain({
        _id: incidentId,
        trackingId: 'MD-7K3Q9XTB',
        title: 'Audit visibility test incident title',
        description: 'Audit visibility test description with valid length.',
        category: 'infrastructure',
        location: { type: 'Point', coordinates: [90.41, 23.81] },
        status: 'published',
        source: 'public',
        incidentAt: new Date(),
        createdAt: new Date(),
        isEdited: false,
        editCount: 0,
        moderatedEdit: false,
      }) as never,
    );
    vi.spyOn(VoteModel, 'aggregate').mockResolvedValue([] as never);
    vi.spyOn(IncidentVersionModel, 'find').mockReturnValue(chain([]) as never);
    vi.spyOn(CommentModel, 'find').mockReturnValue(chain([]) as never);
    vi.spyOn(ReportModel, 'find').mockReturnValue(chain([]) as never);
    vi.spyOn(CommentModel, 'findOne').mockReturnValue(
      chain({
        _id: commentId,
        incidentId,
        actorId: 'a'.repeat(32),
        type: 'corroboration',
        body: 'Sample comment',
        status: 'published',
        redacted: false,
        createdAt: new Date(),
      }) as never,
    );

    const auditFilters: Array<Record<string, unknown>> = [];
    vi.spyOn(AuditLogModel, 'find').mockImplementation(((filter: Record<string, unknown>) => {
      auditFilters.push(filter);
      return chain([]);
    }) as never);

    await withServer(async (baseUrl) => {
      currentRole = 'moderator';
      expect((await fetch(`${baseUrl}/api/v1/admin/dashboard`, { headers: { Cookie: `mdb_admin=${modToken}` } })).status).toBe(200);
      expect((await fetch(`${baseUrl}/api/v1/admin/incidents/${incidentId.toString()}`, { headers: { Cookie: `mdb_admin=${modToken}` } })).status).toBe(200);
      expect((await fetch(`${baseUrl}/api/v1/admin/comments/${commentId.toString()}`, { headers: { Cookie: `mdb_admin=${modToken}` } })).status).toBe(200);

      currentRole = 'super';
      expect((await fetch(`${baseUrl}/api/v1/admin/dashboard`, { headers: { Cookie: `mdb_admin=${superToken}` } })).status).toBe(200);
      expect((await fetch(`${baseUrl}/api/v1/admin/incidents/${incidentId.toString()}`, { headers: { Cookie: `mdb_admin=${superToken}` } })).status).toBe(200);
      expect((await fetch(`${baseUrl}/api/v1/admin/comments/${commentId.toString()}`, { headers: { Cookie: `mdb_admin=${superToken}` } })).status).toBe(200);
    });

    expect(auditFilters[0]).toEqual({ adminId: modId });
    expect(auditFilters[1]).toEqual({ targetType: 'incident', targetId: incidentId, adminId: modId });
    expect(auditFilters[2]).toEqual({ targetType: 'comment', targetId: commentId, adminId: modId });

    expect(auditFilters[3]).toEqual({});
    expect(auditFilters[4]).toEqual({ targetType: 'incident', targetId: incidentId });
    expect(auditFilters[5]).toEqual({ targetType: 'comment', targetId: commentId });
  });

  it('Phase 2A regression (BUG-SEC-2): hides full 32-char actorId, audits ?q= search, and validates lookup scopes', async () => {
    const modId = new Types.ObjectId();
    const actorDbId = new Types.ObjectId();
    const actorDbId2 = new Types.ObjectId();
    const incidentId = new Types.ObjectId();
    const commentId = new Types.ObjectId();
    const actorId32 = 'deadbeef1234567890abcdef12345678';
    const rawToken = '9'.repeat(64);
    const csrfToken = 'phase2a-sec2-csrf-token';

    vi.spyOn(AdminSessionModel, 'findOne').mockReturnValue(
      chain({
        _id: new Types.ObjectId(),
        adminId: modId,
        sessionHash: sha256Hex(rawToken),
        stage: 'active',
        csrfToken,
        createdAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      }) as never,
    );
    vi.spyOn(AdminSessionModel, 'updateOne').mockResolvedValue({ modifiedCount: 1 } as never);
    vi.spyOn(AdminUserModel, 'findOne').mockReturnValue(
      chain({
        _id: modId,
        email: 'mod@mamladibe.org',
        role: 'moderator',
        active: true,
      }) as never,
    );

    const actorDoc = {
      _id: actorDbId,
      actorId: actorId32,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      restrictionHistory: [],
    };
    const incidentDoc = {
      _id: incidentId,
      trackingId: 'MD-7K3Q9XTB',
      actorId: actorId32,
      title: 'Incident list/detail actor redaction verification',
      description: 'Detailed description exceeding twenty characters cleanly.',
      category: 'infrastructure',
      location: { type: 'Point', coordinates: [90.41, 23.81] },
      status: 'published',
      source: 'public',
      incidentAt: new Date(),
      createdAt: new Date(),
      isEdited: false,
      editCount: 0,
      moderatedEdit: false,
    };
    const commentDoc = {
      _id: commentId,
      incidentId,
      actorId: actorId32,
      type: 'corroboration',
      body: 'Comment body check',
      status: 'published',
      redacted: false,
      createdAt: new Date(),
    };

    const auditCreateSpy = vi
      .spyOn(AuditLogModel, 'create')
      .mockResolvedValue({} as never);
    vi.spyOn(IncidentModel, 'find').mockReturnValue(chain([incidentDoc]) as never);
    vi.spyOn(IncidentModel, 'findOne').mockReturnValue(chain(incidentDoc) as never);
    vi.spyOn(CommentModel, 'find').mockReturnValue(chain([commentDoc]) as never);
    vi.spyOn(CommentModel, 'findOne').mockReturnValue(chain(commentDoc) as never);
    vi.spyOn(VoteModel, 'aggregate').mockResolvedValue([] as never);
    vi.spyOn(VoteModel, 'countDocuments').mockResolvedValue(0);
    vi.spyOn(CommentModel, 'countDocuments').mockResolvedValue(0);
    vi.spyOn(ReportModel, 'countDocuments').mockResolvedValue(0);
    vi.spyOn(ReportModel, 'find').mockReturnValue(chain([]) as never);
    vi.spyOn(IncidentVersionModel, 'find').mockReturnValue(chain([]) as never);
    vi.spyOn(DailyQuotaModel, 'findOne').mockReturnValue(chain(null) as never);
    vi.spyOn(AbuseSignalModel, 'aggregate').mockResolvedValue([] as never);
    vi.spyOn(AuditLogModel, 'find').mockReturnValue(chain([]) as never);

    vi.spyOn(ActorModel, 'find').mockReturnValue(chain([actorDoc]) as never);
    vi.spyOn(ActorModel, 'findOne').mockReturnValue(chain(actorDoc) as never);
    vi.spyOn(ActorModel, 'findOneAndUpdate').mockReturnValue(chain(actorDoc) as never);

    await withServer(async (baseUrl) => {
      const authHeaders = { Cookie: `mdb_admin=${rawToken}` };
      const mutHeaders = {
        ...authHeaders,
        Origin: ORIGIN,
        'x-csrf-token': csrfToken,
        'Content-Type': 'application/json',
      };

      // 1. Full 32-char actorId never exposed across list & detail endpoints
      for (const path of [
        '/api/v1/admin/incidents',
        `/api/v1/admin/incidents/${incidentId.toString()}`,
        '/api/v1/admin/comments',
        `/api/v1/admin/comments/${commentId.toString()}`,
        '/api/v1/admin/actors',
        `/api/v1/admin/actors/${actorDbId.toString()}`,
      ]) {
        const res = await fetch(`${baseUrl}${path}`, { headers: authHeaders });
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).not.toContain(actorId32);
        expect(text).toContain(actorId32.slice(0, 8));
      }

      // 2. GET /actors?q= logs actor.view without full actorId & supports partial MD- live typing safely
      auditCreateSpy.mockClear();
      expect((await fetch(`${baseUrl}/api/v1/admin/actors?q=${actorId32}`, { headers: authHeaders })).status).toBe(200);
      expect((await fetch(`${baseUrl}/api/v1/admin/actors?q=MD-7K3Q9XTB`, { headers: authHeaders })).status).toBe(200);
      const partialRes = await fetch(`${baseUrl}/api/v1/admin/actors?q=MD-2026`, { headers: authHeaders });
      expect(partialRes.status).toBe(200);
      expect(await partialRes.json()).toEqual({ items: [], nextCursor: null });
      expect(auditCreateSpy).toHaveBeenCalledTimes(3);
      for (const call of auditCreateSpy.mock.calls) {
        expect(call[0]).toMatchObject({ action: 'actor.view', targetType: 'actor' });
        expect(JSON.stringify(call[0])).not.toContain(actorId32);
      }

      // 3. GET /actors/:id accepts prefix (>=8), trackingId, 24-hex _id, and 32-hex actorId
      expect((await fetch(`${baseUrl}/api/v1/admin/actors/${actorId32.slice(0, 8)}`, { headers: authHeaders })).status).toBe(200);
      expect((await fetch(`${baseUrl}/api/v1/admin/actors/MD-7K3Q9XTB`, { headers: authHeaders })).status).toBe(200);
      expect((await fetch(`${baseUrl}/api/v1/admin/actors/${actorDbId.toString()}`, { headers: authHeaders })).status).toBe(200);
      expect((await fetch(`${baseUrl}/api/v1/admin/actors/${actorId32}`, { headers: authHeaders })).status).toBe(200);

      // 4. Rejects <8-char string and ambiguous prefix on GET /actors/:id
      expect((await fetch(`${baseUrl}/api/v1/admin/actors/deadbee`, { headers: authHeaders })).status).toBe(400);
      vi.spyOn(ActorModel, 'find').mockReturnValueOnce(
        chain([actorDoc, { ...actorDoc, _id: actorDbId2, actorId: 'deadbeef999999999999999999999999' }]) as never,
      );
      expect((await fetch(`${baseUrl}/api/v1/admin/actors/deadbeef`, { headers: authHeaders })).status).toBe(400);

      // 5. Rejects truncated prefix on mutations while accepting 24-hex _id and logging actorIdShort
      expect(
        (await fetch(`${baseUrl}/api/v1/admin/actors/${actorId32.slice(0, 8)}/restrict`, {
          method: 'POST',
          headers: mutHeaders,
          body: JSON.stringify({ scope: ['comment'], days: 7, reason: 'Abuse check' }),
        })).status,
      ).toBe(400);

      auditCreateSpy.mockClear();
      const restrictByIdRes = await fetch(
        `${baseUrl}/api/v1/admin/actors/${actorDbId.toString()}/restrict`,
        {
          method: 'POST',
          headers: mutHeaders,
          body: JSON.stringify({ scope: ['comment'], days: 7, reason: 'Valid _id restrict' }),
        },
      );
      expect(restrictByIdRes.status).toBe(200);
      expect(auditCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'actor.restrict',
          targetId: actorDbId,
          after: expect.objectContaining({ actorIdShort: actorId32.slice(0, 8) }),
        }),
      );

      // 6. Incident & comment list actorId filter rejects non-hex inputs
      expect((await fetch(`${baseUrl}/api/v1/admin/incidents?actorId=not-hex!`, { headers: authHeaders })).status).toBe(400);
      expect((await fetch(`${baseUrl}/api/v1/admin/comments?actorId=not-hex!`, { headers: authHeaders })).status).toBe(400);
    });
  });

  it('Phase 2A regression (BUG-SEC-4): fails closed (500) on admin login and verify-2fa when IP_HMAC_SECRET is missing', async () => {
    delete process.env.IP_HMAC_SECRET;

    const store = new InMemoryRateLimitStore();
    const slidingSpy = vi.spyOn(store, 'checkSlidingWindow');
    setRateLimitStoreForTests(store);

    const pendingAdminId = new Types.ObjectId();
    const adminFindSpy = vi.spyOn(AdminUserModel, 'findOne').mockReturnValue(
      chain({
        _id: pendingAdminId,
        email: 'mod@mamladibe.org',
        role: 'moderator',
        active: true,
      }) as never,
    );
    const pendingToken = '7'.repeat(64);
    vi.spyOn(AdminSessionModel, 'findOne').mockReturnValue(
      chain({
        _id: new Types.ObjectId(),
        adminId: pendingAdminId,
        sessionHash: sha256Hex(pendingToken),
        stage: 'pending_2fa',
        csrfToken: 'csrf',
        createdAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 600_000),
      }) as never,
    );

    await withServer(async (baseUrl) => {
      const loginRes = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': '203.0.113.88',
        },
        body: JSON.stringify({
          email: 'mod@mamladibe.org',
          password: 'VeryStrongPassword!123',
        }),
      });
      expect(loginRes.status).toBe(500);
      expect(await loginRes.text()).not.toContain('203.0.113.88');
      expect(adminFindSpy).not.toHaveBeenCalled();

      const verifyRes = await fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: `mdb_admin=${pendingToken}`,
          'X-Forwarded-For': '203.0.113.88',
        },
        body: JSON.stringify({ code: '123456' }),
      });
      expect(verifyRes.status).toBe(500);
      expect(await verifyRes.text()).not.toContain('203.0.113.88');
    });

    expect(slidingSpy).not.toHaveBeenCalled();
    expect(adminFindSpy).toHaveBeenCalledTimes(1);
  });

  it('Phase 2B (Decision 1): locks account on 5 failed TOTP attempts, revokes pending_2fa sessions, prevents session-recreation bypass, and audits without secrets', async () => {
    const adminId = new Types.ObjectId();
    const password = 'VeryStrongPassword!123';
    const passwordHash = await hashAdminPassword(password);
    const totpSecret = generateSecret();
    const totpSecretEnc = encryptTotpSecret(totpSecret, TOTP_KEY);

    const adminDoc: {
      _id: Types.ObjectId;
      email: string;
      passwordHash: string;
      role: 'super';
      totpSecretEnc: string;
      totpEnabled: boolean;
      failedLogins: number;
      lockedUntil?: Date;
      active: boolean;
    } = {
      _id: adminId,
      email: 'totp-lock@mamladibe.org',
      passwordHash,
      role: 'super',
      totpSecretEnc,
      totpEnabled: true,
      failedLogins: 0,
      active: true,
    };

    const sessions = new Map<string, Record<string, unknown>>();
    const { findOneSpy } = mockSingleAdminUserAtomic(adminDoc);

    vi.spyOn(AdminSessionModel, 'create').mockImplementation((async (
      doc: Record<string, unknown>,
    ) => {
      const record = { _id: new Types.ObjectId(), ...doc };
      sessions.set(String(doc.sessionHash), record);
      return record;
    }) as never);

    vi.spyOn(AdminSessionModel, 'findOne').mockImplementation(((
      filter: { sessionHash?: string },
    ) => chain(sessions.get(filter.sessionHash ?? '') ?? null)) as never);

    vi.spyOn(AdminSessionModel, 'updateOne').mockImplementation((async (
      filter: { _id?: Types.ObjectId },
      update: { $set?: Record<string, unknown> },
    ) => {
      for (const [hash, rec] of Array.from(sessions.entries())) {
        if ((rec._id as Types.ObjectId).equals(filter._id!)) {
          sessions.delete(hash);
          Object.assign(rec, update.$set ?? {});
          sessions.set(String(rec.sessionHash), rec);
          break;
        }
      }
      return { modifiedCount: 1 };
    }) as never);

    const deleteManySessionsSpy = vi
      .spyOn(AdminSessionModel, 'deleteMany')
      .mockImplementation((async (filter: { adminId?: Types.ObjectId; stage?: string }) => {
        let deletedCount = 0;
        for (const [hash, rec] of sessions.entries()) {
          const sameAdmin = !filter.adminId || filter.adminId.equals(rec.adminId as Types.ObjectId);
          const sameStage = !filter.stage || rec.stage === filter.stage;
          if (sameAdmin && sameStage) {
            sessions.delete(hash);
            deletedCount += 1;
          }
        }
        return { deletedCount };
      }) as never);

    const auditCreateSpy = vi.spyOn(AuditLogModel, 'create');

    await withServer(async (baseUrl) => {
      // 1. Valid password -> pending session S1
      const login1 = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': '203.0.113.55',
        },
        body: JSON.stringify({ email: adminDoc.email, password }),
      });
      expect(login1.status).toBe(200);
      const cookie1 = extractAdminCookie(login1)!;

      // 2. 3 bad TOTP attempts -> failedLogins reaches 3
      const badCode = (await generateTotp({ secret: totpSecret })) === '000000' ? '111111' : '000000';
      for (let i = 1; i <= 3; i += 1) {
        const failRes = await fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            Cookie: cookie1,
            'X-Forwarded-For': '203.0.113.55',
          },
          body: JSON.stringify({ code: badCode }),
        });
        expect(failRes.status).toBe(401);
        expect(adminDoc.failedLogins).toBe(i);
      }

      // 3. Re-login with valid password creates S2 but MUST NOT reset failedLogins!
      const login2 = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': '203.0.113.55',
        },
        body: JSON.stringify({ email: adminDoc.email, password }),
      });
      expect(login2.status).toBe(200);
      expect(adminDoc.failedLogins).toBe(3);
      expect(sessions.size).toBe(2);
      const cookie2 = extractAdminCookie(login2)!;

      // 4. 4th failure on S2 -> 401, 5th failure on S2 -> 423 LOCKED and revokes ALL pending_2fa sessions!
      const fail4 = await fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: cookie2,
          'X-Forwarded-For': '203.0.113.55',
        },
        body: JSON.stringify({ code: badCode }),
      });
      expect(fail4.status).toBe(401);
      expect(adminDoc.failedLogins).toBe(4);

      const fail5 = await fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: cookie2,
          'X-Forwarded-For': '203.0.113.55',
        },
        body: JSON.stringify({ code: badCode }),
      });
      expect(fail5.status).toBe(423);
      const fail5Json = (await fail5.json()) as {
        error: { code: string; details?: { retryAfterSeconds?: number } };
      };
      expect(fail5Json.error.code).toBe('LOCKED');
      expect(fail5Json.error.details?.retryAfterSeconds).toBe(ADMIN.LOCK_MINUTES * 60);
      expect(deleteManySessionsSpy).toHaveBeenCalledWith({
        adminId,
        stage: 'pending_2fa',
      });
      expect(sessions.size).toBe(0);
      expect(adminDoc.lockedUntil).toBeInstanceOf(Date);
      expect(fail5.headers.get('set-cookie')).toContain('mdb_admin=;');

      // 5. Neither revoked pending cookie S1 nor new password login works while locked
      const reusePending = await fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: cookie1,
          'X-Forwarded-For': '203.0.113.55',
        },
        body: JSON.stringify({ code: await generateTotp({ secret: totpSecret }) }),
      });
      expect(reusePending.status).toBe(401);

      const lockedLogin = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': '203.0.113.55',
        },
        body: JSON.stringify({ email: adminDoc.email, password }),
      });
      expect(lockedLogin.status).toBe(423);

      // 6. Audit logs record auth.login_failed without TOTP code, secret, or raw IP
      const auditPayloads = auditCreateSpy.mock.calls.map(([entry]) => entry as Record<string, unknown>);
      const failedAuditPayloads = auditPayloads.filter((e) => e.action === 'auth.login_failed');
      expect(failedAuditPayloads.length).toBeGreaterThanOrEqual(6);
      const serializedAudits = JSON.stringify(failedAuditPayloads);
      expect(serializedAudits).not.toContain(badCode);
      expect(serializedAudits).not.toContain(totpSecret);
      expect(serializedAudits).not.toContain(totpSecretEnc);
      expect(serializedAudits).not.toContain('203.0.113.55');
      expect(serializedAudits).not.toContain(password);
    });
  });

  it('Phase 2B (Decision 1): shares password+TOTP failure count, enforces lockedUntil & IP rate limit on verify-2fa, and resets failure state on success', async () => {
    const adminId = new Types.ObjectId();
    const password = 'VeryStrongPassword!123';
    const passwordHash = await hashAdminPassword(password);
    const totpSecret = generateSecret();
    const adminDoc: {
      _id: Types.ObjectId;
      email: string;
      passwordHash: string;
      role: 'moderator';
      totpSecretEnc: string;
      totpEnabled: boolean;
      failedLogins: number;
      lockedUntil?: Date;
      active: boolean;
    } = {
      _id: adminId,
      email: 'shared-auth@mamladibe.org',
      passwordHash,
      role: 'moderator',
      totpSecretEnc: encryptTotpSecret(totpSecret, TOTP_KEY),
      totpEnabled: true,
      failedLogins: 0,
      active: true,
    };

    const sessions = new Map<string, Record<string, unknown>>();
    const { findOneSpy } = mockSingleAdminUserAtomic(adminDoc);
    vi.spyOn(AdminSessionModel, 'create').mockImplementation((async (
      doc: Record<string, unknown>,
    ) => {
      const rec = { _id: new Types.ObjectId(), ...doc };
      sessions.set(String(doc.sessionHash), rec);
      return rec;
    }) as never);
    vi.spyOn(AdminSessionModel, 'findOne').mockImplementation(((
      filter: { sessionHash?: string },
    ) => chain(sessions.get(filter.sessionHash ?? '') ?? null)) as never);
    vi.spyOn(AdminSessionModel, 'updateOne').mockImplementation((async (
      filter: { _id?: Types.ObjectId },
      update: { $set?: Record<string, unknown> },
    ) => {
      for (const [hash, rec] of Array.from(sessions.entries())) {
        if ((rec._id as Types.ObjectId).equals(filter._id!)) {
          sessions.delete(hash);
          Object.assign(rec, update.$set ?? {});
          sessions.set(String(rec.sessionHash), rec);
          break;
        }
      }
      return { modifiedCount: 1 };
    }) as never);
    vi.spyOn(AdminSessionModel, 'deleteMany').mockResolvedValue({ deletedCount: 1 } as never);
    const deleteOneSessionSpy = vi
      .spyOn(AdminSessionModel, 'deleteOne')
      .mockImplementation((async (filter: { _id?: Types.ObjectId }) => {
        let deletedCount = 0;
        for (const [hash, rec] of Array.from(sessions.entries())) {
          if (filter._id && (rec._id as Types.ObjectId).equals(filter._id)) {
            sessions.delete(hash);
            deletedCount += 1;
          }
        }
        return { deletedCount };
      }) as never);

    await withServer(async (baseUrl) => {
      // 1. 2 failed passwords + 1 failed TOTP (shared counter = 3), then valid TOTP clears to 0
      for (let i = 0; i < 2; i += 1) {
        const badPassRes = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            'X-Forwarded-For': '198.51.100.11',
          },
          body: JSON.stringify({ email: adminDoc.email, password: 'WrongPassword!1234' }),
        });
        expect(badPassRes.status).toBe(401);
      }
      expect(adminDoc.failedLogins).toBe(2);

      const goodLoginRes = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': '198.51.100.11',
        },
        body: JSON.stringify({ email: adminDoc.email, password }),
      });
      expect(goodLoginRes.status).toBe(200);
      expect(adminDoc.failedLogins).toBe(2);
      const pendingCookie = extractAdminCookie(goodLoginRes)!;

      const validCode = await generateTotp({ secret: totpSecret });
      const wrongCode = validCode === '000000' ? '111111' : '000000';
      const badTotpRes = await fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: pendingCookie,
          'X-Forwarded-For': '198.51.100.11',
        },
        body: JSON.stringify({ code: wrongCode }),
      });
      expect(badTotpRes.status).toBe(401);
      expect(adminDoc.failedLogins).toBe(3);

      const okTotpRes = await fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: pendingCookie,
          'X-Forwarded-For': '198.51.100.11',
        },
        body: JSON.stringify({ code: validCode }),
      });
      expect(okTotpRes.status).toBe(200);
      expect(adminDoc.failedLogins).toBe(0);
      expect(adminDoc.lockedUntil).toBeUndefined();

      // Replay of the same TOTP code on a new pending session increments failedLogins and audits auth.login_failed
      const replayToken = '9'.repeat(64);
      sessions.set(sha256Hex(replayToken), {
        _id: new Types.ObjectId(),
        adminId,
        sessionHash: sha256Hex(replayToken),
        stage: 'pending_2fa',
        csrfToken: 'csrf-replay',
        createdAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 600_000),
      });
      const auditSpyForReplay = vi.spyOn(AuditLogModel, 'create');
      auditSpyForReplay.mockClear();
      const replayRes = await fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: `mdb_admin=${replayToken}`,
          'X-Forwarded-For': '198.51.100.12',
        },
        body: JSON.stringify({ code: validCode }),
      });
      expect(replayRes.status).toBe(401);
      expect(adminDoc.failedLogins).toBe(1);
      expect(auditSpyForReplay).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.login_failed',
          targetId: adminId,
          reason: 'Replayed TOTP verification code',
        }),
      );
      adminDoc.failedLogins = 0;

      // 2. Existing pending_2fa session on a locked account is rejected with 423 LOCKED
      const staleToken = 'a'.repeat(64);
      sessions.set(sha256Hex(staleToken), {
        _id: new Types.ObjectId(),
        adminId,
        sessionHash: sha256Hex(staleToken),
        stage: 'pending_2fa',
        csrfToken: 'csrf-pending',
        createdAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 600_000),
      });
      adminDoc.lockedUntil = new Date(Date.now() + 10 * 60_000);

      const lockedVerifyRes = await fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: `mdb_admin=${staleToken}`,
          'X-Forwarded-For': '198.51.100.11',
        },
        body: JSON.stringify({ code: wrongCode }),
      });
      expect(lockedVerifyRes.status).toBe(423);

      // 3. Per-pending_2fa-session limit revokes exhausted session even if account counter wasn't locked
      adminDoc.lockedUntil = undefined;
      adminDoc.failedLogins = 0;
      const exhaustedToken = 'c'.repeat(64);
      const exhaustedSessionId = new Types.ObjectId();
      sessions.set(sha256Hex(exhaustedToken), {
        _id: exhaustedSessionId,
        adminId,
        sessionHash: sha256Hex(exhaustedToken),
        stage: 'pending_2fa',
        csrfToken: 'csrf-exhausted',
        createdAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 600_000),
      });

      for (let i = 0; i < ADMIN.TOTP_SESSION_MAX_FAILS; i += 1) {
        adminDoc.failedLogins = 0;
        const failRes = await fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            Cookie: `mdb_admin=${exhaustedToken}`,
            'X-Forwarded-For': '198.51.100.55',
          },
          body: JSON.stringify({ code: wrongCode }),
        });
        expect(failRes.status).toBe(401);
        if (i === ADMIN.TOTP_SESSION_MAX_FAILS - 1) {
          expect(failRes.headers.get('set-cookie')).toContain('mdb_admin=;');
        }
      }
      expect(deleteOneSessionSpy).toHaveBeenCalledWith({ _id: exhaustedSessionId });
      expect(sessions.has(sha256Hex(exhaustedToken))).toBe(false);

      // 4. IP rate limit preserved on /auth/verify-2fa (exceeding 10 attempts from distinct IP returns 429)
      adminDoc.lockedUntil = undefined;
      adminDoc.failedLogins = 0;
      const mintRateCookie = (suffix: string) => {
        const tok = suffix.repeat(64);
        sessions.set(sha256Hex(tok), {
          _id: new Types.ObjectId(),
          adminId,
          sessionHash: sha256Hex(tok),
          stage: 'pending_2fa',
          csrfToken: `csrf-rate-${suffix}`,
          createdAt: new Date(),
          lastSeenAt: new Date(),
          expiresAt: new Date(Date.now() + 600_000),
        });
        return `mdb_admin=${tok}`;
      };

      const rateCookies = [mintRateCookie('d'), mintRateCookie('e'), mintRateCookie('f')];
      for (let i = 0; i < 10; i += 1) {
        // Keep DB & per-session counters below lock thresholds to isolate the IP sliding window limiter
        adminDoc.failedLogins = 0;
        const cookie = rateCookies[Math.floor(i / 4)]!;
        const attemptRes = await fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            Cookie: cookie,
            'X-Forwarded-For': '198.51.100.99',
          },
          body: JSON.stringify({ code: wrongCode }),
        });
        expect(attemptRes.status).toBe(401);
      }

      const ipRateLimitedRes = await fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: rateCookies[2]!,
          'X-Forwarded-For': '198.51.100.99',
        },
        body: JSON.stringify({ code: wrongCode }),
      });
      expect(ipRateLimitedRes.status).toBe(429);
    });
  });

  it('Phase 2B (Decisions 2 & 3): enforces soft-deactivation on DELETE /users/:id, actor.notes auditing, mandatory reasons, RBAC, and CSRF', async () => {
    const superId = new Types.ObjectId();
    const superSessionId = new Types.ObjectId();
    const modId = new Types.ObjectId();
    const modSessionId = new Types.ObjectId();
    const targetAdminId = new Types.ObjectId();
    const actorDbId = new Types.ObjectId();
    const fullActorId = 'f1e2d3c4b5a69788796a5b4c3d2e1f00';

    const superRawToken = '1'.repeat(64);
    const superCsrf = 'phase2b-super-csrf';
    const modRawToken = '2'.repeat(64);
    const modCsrf = 'phase2b-mod-csrf';

    const targetPasswordHash = await hashAdminPassword('TargetStrong!Pass123');
    const users = new Map<string, Record<string, unknown>>([
      [
        superId.toString(),
        {
          _id: superId,
          email: 'super2b@mamladibe.org',
          passwordHash: targetPasswordHash,
          role: 'super',
          totpSecretEnc: encryptTotpSecret(generateSecret(), TOTP_KEY),
          totpEnabled: true,
          failedLogins: 0,
          active: true,
          createdAt: new Date(),
        },
      ],
      [
        modId.toString(),
        {
          _id: modId,
          email: 'mod2b@mamladibe.org',
          passwordHash: targetPasswordHash,
          role: 'moderator',
          totpSecretEnc: encryptTotpSecret(generateSecret(), TOTP_KEY),
          totpEnabled: true,
          failedLogins: 0,
          active: true,
          createdAt: new Date(),
        },
      ],
      [
        targetAdminId.toString(),
        {
          _id: targetAdminId,
          email: 'target-mod@mamladibe.org',
          passwordHash: targetPasswordHash,
          role: 'moderator',
          totpSecretEnc: encryptTotpSecret(generateSecret(), TOTP_KEY),
          totpEnabled: true,
          failedLogins: 0,
          active: true,
          createdAt: new Date(),
        },
      ],
    ]);

    const sessions = new Map<string, Record<string, unknown>>([
      [
        sha256Hex(superRawToken),
        {
          _id: superSessionId,
          adminId: superId,
          sessionHash: sha256Hex(superRawToken),
          stage: 'active',
          csrfToken: superCsrf,
          createdAt: new Date(),
          lastSeenAt: new Date(),
          expiresAt: new Date(Date.now() + 3600_000),
        },
      ],
      [
        sha256Hex(modRawToken),
        {
          _id: modSessionId,
          adminId: modId,
          sessionHash: sha256Hex(modRawToken),
          stage: 'active',
          csrfToken: modCsrf,
          createdAt: new Date(),
          lastSeenAt: new Date(),
          expiresAt: new Date(Date.now() + 3600_000),
        },
      ],
      [
        sha256Hex('3'.repeat(64)),
        {
          _id: new Types.ObjectId(),
          adminId: targetAdminId,
          sessionHash: sha256Hex('3'.repeat(64)),
          stage: 'active',
          csrfToken: 'target-csrf',
          createdAt: new Date(),
          lastSeenAt: new Date(),
          expiresAt: new Date(Date.now() + 3600_000),
        },
      ],
    ]);

    const actorDoc: Record<string, unknown> = {
      _id: actorDbId,
      actorId: fullActorId,
      firstSeenAt: new Date(Date.now() - 86400_000),
      lastSeenAt: new Date(),
      restrictionHistory: [],
      notes: 'Initial note',
    };

    vi.spyOn(AdminSessionModel, 'findOne').mockImplementation(((
      filter: { sessionHash?: string },
    ) => chain(sessions.get(filter.sessionHash ?? '') ?? null)) as never);
    vi.spyOn(AdminSessionModel, 'updateOne').mockResolvedValue({ modifiedCount: 1 } as never);
    vi.spyOn(AdminSessionModel, 'deleteOne').mockResolvedValue({ deletedCount: 1 } as never);
    const deleteManySessionsSpy = vi
      .spyOn(AdminSessionModel, 'deleteMany')
      .mockImplementation((async (filter: { adminId?: Types.ObjectId }) => {
        let deletedCount = 0;
        for (const [hash, rec] of sessions.entries()) {
          if (filter.adminId?.equals(rec.adminId as Types.ObjectId)) {
            sessions.delete(hash);
            deletedCount += 1;
          }
        }
        return { deletedCount };
      }) as never);

    vi.spyOn(AdminUserModel, 'findOne').mockImplementation(((
      filter: { _id?: Types.ObjectId; email?: string; active?: boolean },
    ) => {
      let found: Record<string, unknown> | undefined;
      if (filter._id) {
        found = users.get(filter._id.toString());
      } else if (filter.email) {
        found = Array.from(users.values()).find((u) => u.email === filter.email);
      }
      if (found && filter.active !== undefined && found.active !== filter.active) {
        found = undefined;
      }
      return chain(found ? { ...found } : null) as never;
    }) as never);

    vi.spyOn(AdminUserModel, 'countDocuments').mockImplementation((async (
      filter: { role?: string; active?: boolean },
    ) => {
      return Array.from(users.values()).filter(
        (u) =>
          (filter.role === undefined || u.role === filter.role) &&
          (filter.active === undefined || u.active === filter.active),
      ).length;
    }) as never);

    vi.spyOn(AdminUserModel, 'findOneAndUpdate').mockImplementation(((
      filter: { _id: Types.ObjectId },
      update: { $set?: Record<string, unknown> },
    ) => {
      const existing = users.get(filter._id.toString());
      if (!existing) return chain(null) as never;
      if (update.$set) Object.assign(existing, update.$set);
      return chain({ ...existing }) as never;
    }) as never);

    vi.spyOn(AdminUserModel, 'updateOne').mockImplementation((async (
      filter: { _id: Types.ObjectId },
      update: { $set?: Record<string, unknown> },
    ) => {
      const existing = users.get(filter._id.toString());
      if (existing && update.$set) Object.assign(existing, update.$set);
      return { modifiedCount: existing ? 1 : 0 };
    }) as never);

    vi.spyOn(AdminUserModel, 'create').mockImplementation((async (
      doc: Record<string, unknown>,
    ) => {
      const nextId = new Types.ObjectId();
      const saved = { _id: nextId, ...doc };
      users.set(nextId.toString(), saved);
      return { toObject: () => ({ ...saved }), ...saved };
    }) as never);

    const hardDeleteUserSpy = vi.spyOn(AdminUserModel, 'deleteOne');

    vi.spyOn(ActorModel, 'findOne').mockImplementation(((
      filter: { _id?: Types.ObjectId; actorId?: string },
    ) => {
      const match =
        (filter._id && actorDbId.equals(filter._id)) ||
        (filter.actorId && filter.actorId === fullActorId);
      return chain(match ? { ...actorDoc } : null) as never;
    }) as never);

    vi.spyOn(ActorModel, 'findOneAndUpdate').mockImplementation(((
      filter: { _id: Types.ObjectId },
      update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> },
    ) => {
      if (!actorDbId.equals(filter._id)) return chain(null) as never;
      if (update.$set) Object.assign(actorDoc, update.$set);
      if (update.$unset && 'notes' in update.$unset) delete actorDoc.notes;
      return chain({ ...actorDoc }) as never;
    }) as never);

    const auditCreateSpy = vi.spyOn(AuditLogModel, 'create');

    await withServer(async (baseUrl) => {
      const superHeaders = {
        Cookie: `mdb_admin=${superRawToken}`,
        Origin: ORIGIN,
        'x-csrf-token': superCsrf,
        'Content-Type': 'application/json',
      };
      const modHeaders = {
        Cookie: `mdb_admin=${modRawToken}`,
        Origin: ORIGIN,
        'x-csrf-token': modCsrf,
        'Content-Type': 'application/json',
      };

      // 1. CSRF check & RBAC checks
      const noCsrfNotes = await fetch(`${baseUrl}/api/v1/admin/actors/${actorDbId.toString()}/notes`, {
        method: 'PATCH',
        headers: { Cookie: `mdb_admin=${modRawToken}`, Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'Missing CSRF' }),
      });
      expect(noCsrfNotes.status).toBe(403);

      const modDeleteUser = await fetch(`${baseUrl}/api/v1/admin/users/${targetAdminId.toString()}`, {
        method: 'DELETE',
        headers: modHeaders,
      });
      expect(modDeleteUser.status).toBe(403);

      const modCreateUser = await fetch(`${baseUrl}/api/v1/admin/users`, {
        method: 'POST',
        headers: modHeaders,
        body: JSON.stringify({
          email: 'blocked-mod@mamladibe.org',
          password: 'AnotherStrong!Pass999',
          role: 'moderator',
        }),
      });
      expect(modCreateUser.status).toBe(403);

      const modUpdateUser = await fetch(`${baseUrl}/api/v1/admin/users/${targetAdminId.toString()}`, {
        method: 'PATCH',
        headers: modHeaders,
        body: JSON.stringify({ active: false, reason: 'Unauthorized attempt' }),
      });
      expect(modUpdateUser.status).toBe(403);

      const modReset2fa = await fetch(`${baseUrl}/api/v1/admin/users/${targetAdminId.toString()}/reset-2fa`, {
        method: 'POST',
        headers: modHeaders,
        body: JSON.stringify({ reason: 'Unauthorized attempt' }),
      });
      expect(modReset2fa.status).toBe(403);

      // 2. PATCH /actors/:id/notes writes 'actor.notes' audit log (with default & explicit reasons) without full actorId
      auditCreateSpy.mockClear();
      const notesDefaultRes = await fetch(`${baseUrl}/api/v1/admin/actors/${actorDbId.toString()}/notes`, {
        method: 'PATCH',
        headers: modHeaders,
        body: JSON.stringify({ notes: 'Coordinated spam links' }),
      });
      expect(notesDefaultRes.status).toBe(200);
      const notesDefaultText = await notesDefaultRes.text();
      expect(notesDefaultText).not.toContain(fullActorId);
      expect(auditCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: modId,
          action: 'actor.notes',
          targetType: 'actor',
          targetId: actorDbId,
          reason: 'Actor moderator notes updated',
          after: expect.objectContaining({ actorIdShort: fullActorId.slice(0, 8) }),
        }),
      );
      expect(JSON.stringify(auditCreateSpy.mock.calls)).not.toContain(fullActorId);

      auditCreateSpy.mockClear();
      const notesReasonRes = await fetch(`${baseUrl}/api/v1/admin/actors/${actorDbId.toString()}/notes`, {
        method: 'PATCH',
        headers: modHeaders,
        body: JSON.stringify({ notes: null, reason: 'False positive cleared' }),
      });
      expect(notesReasonRes.status).toBe(200);
      expect(auditCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'actor.notes',
          reason: 'False positive cleared',
          after: expect.objectContaining({ actorIdShort: fullActorId.slice(0, 8), notes: null }),
        }),
      );

      // 3. PATCH /users/:id enforces mandatory reason + last active super-admin protection
      const missingReasonUpdate = await fetch(`${baseUrl}/api/v1/admin/users/${targetAdminId.toString()}`, {
        method: 'PATCH',
        headers: superHeaders,
        body: JSON.stringify({ role: 'super' }),
      });
      expect(missingReasonUpdate.status).toBe(400);

      const promoteRes = await fetch(`${baseUrl}/api/v1/admin/users/${targetAdminId.toString()}`, {
        method: 'PATCH',
        headers: superHeaders,
        body: JSON.stringify({ role: 'super', reason: 'Backup super admin promotion' }),
      });
      expect(promoteRes.status).toBe(200);

      // Protect against deleting the last active Super Admin
      vi.spyOn(AdminUserModel, 'countDocuments').mockResolvedValueOnce(1 as never);
      const deleteLastSuperRes = await fetch(
        `${baseUrl}/api/v1/admin/users/${targetAdminId.toString()}`,
        { method: 'DELETE', headers: superHeaders },
      );
      expect(deleteLastSuperRes.status).toBe(403);

      // Demote back so targetAdminId becomes moderator again
      const demoteRes = await fetch(`${baseUrl}/api/v1/admin/users/${targetAdminId.toString()}`, {
        method: 'PATCH',
        headers: superHeaders,
        body: JSON.stringify({ role: 'moderator', reason: 'Revert temporary promotion' }),
      });
      expect(demoteRes.status).toBe(200);

      // 4. DELETE /users/:id blocks self-delete and supports omitting JSON body cleanly
      const selfDelete = await fetch(`${baseUrl}/api/v1/admin/users/${superId.toString()}`, {
        method: 'DELETE',
        headers: superHeaders,
      });
      expect(selfDelete.status).toBe(403);

      // 5. POST /users works without reason (client compatibility) & with optional reason
      const createWithoutReasonRes = await fetch(`${baseUrl}/api/v1/admin/users`, {
        method: 'POST',
        headers: superHeaders,
        body: JSON.stringify({
          email: 'no-reason-mod@mamladibe.org',
          password: 'AnotherStrong!Pass999',
          role: 'moderator',
        }),
      });
      expect(createWithoutReasonRes.status).toBe(201);
      const createdNoReasonId = (
        (await createWithoutReasonRes.json()) as { user: { id: string } }
      ).user.id;

      // DELETE without JSON body deactivates cleanly too
      const deleteWithoutBodyRes = await fetch(
        `${baseUrl}/api/v1/admin/users/${createdNoReasonId}`,
        {
          method: 'DELETE',
          headers: {
            Cookie: `mdb_admin=${superRawToken}`,
            Origin: ORIGIN,
            'x-csrf-token': superCsrf,
          },
        },
      );
      expect(deleteWithoutBodyRes.status).toBe(200);
      expect(((await deleteWithoutBodyRes.json()) as { active: boolean }).active).toBe(false);

      auditCreateSpy.mockClear();
      const createUserRes = await fetch(`${baseUrl}/api/v1/admin/users`, {
        method: 'POST',
        headers: superHeaders,
        body: JSON.stringify({
          email: 'new-mod@mamladibe.org',
          password: 'AnotherStrong!Pass999',
          role: 'moderator',
          reason: 'Onboarded night shift moderator',
        }),
      });
      expect(createUserRes.status).toBe(201);
      expect(auditCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'user.create',
          reason: 'Onboarded night shift moderator',
        }),
      );

      // 6. DELETE /users/:id soft-deactivates (active: false), revokes all sessions, preserves record, logs user.delete
      auditCreateSpy.mockClear();
      const deleteTargetRes = await fetch(`${baseUrl}/api/v1/admin/users/${targetAdminId.toString()}`, {
        method: 'DELETE',
        headers: superHeaders,
        body: JSON.stringify({ reason: 'Moderator departed team' }),
      });
      expect(deleteTargetRes.status).toBe(200);
      const deleteTargetJson = (await deleteTargetRes.json()) as {
        deleted: boolean;
        active: boolean;
        user: { active: boolean };
      };
      expect(deleteTargetJson.deleted).toBe(true);
      expect(deleteTargetJson.active).toBe(false);
      expect(deleteTargetJson.user.active).toBe(false);
      expect(hardDeleteUserSpy).not.toHaveBeenCalled();
      expect(deleteManySessionsSpy).toHaveBeenCalledWith({ adminId: targetAdminId });
      expect(users.get(targetAdminId.toString())?.active).toBe(false);
      expect(auditCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'user.delete',
          targetType: 'admin_user',
          targetId: targetAdminId,
          reason: 'Moderator departed team',
          before: expect.objectContaining({ active: true }),
          after: expect.objectContaining({ active: false }),
        }),
      );

      // Deactivated user's session was revoked and deactivated login writes auth.login_failed + returns 401
      const targetOldSessionRes = await fetch(`${baseUrl}/api/v1/admin/auth/me`, {
        headers: { Cookie: `mdb_admin=${'3'.repeat(64)}` },
      });
      expect(targetOldSessionRes.status).toBe(401);

      auditCreateSpy.mockClear();
      const inactiveLoginRes = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({
          email: 'target-mod@mamladibe.org',
          password: 'TargetStrong!Pass123',
        }),
      });
      expect(inactiveLoginRes.status).toBe(401);
      expect(auditCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.login_failed',
          targetId: targetAdminId,
        }),
      );

      // 7. POST /users/:id/reset-2fa requires reason and revokes sessions
      const missingResetReason = await fetch(`${baseUrl}/api/v1/admin/users/${modId.toString()}/reset-2fa`, {
        method: 'POST',
        headers: superHeaders,
        body: JSON.stringify({}),
      });
      expect(missingResetReason.status).toBe(400);

      auditCreateSpy.mockClear();
      const validReset2fa = await fetch(`${baseUrl}/api/v1/admin/users/${modId.toString()}/reset-2fa`, {
        method: 'POST',
        headers: superHeaders,
        body: JSON.stringify({ reason: 'Hardware device replaced' }),
      });
      expect(validReset2fa.status).toBe(200);
      expect(auditCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'user.reset2fa',
          targetId: modId,
          reason: 'Hardware device replaced',
        }),
      );
      expect(deleteManySessionsSpy).toHaveBeenCalledWith({ adminId: modId });
    });
  }, 15000);

  it('Phase 2B.1: concurrent failed TOTP attempts increment atomically without lost updates and lock at 5', async () => {
    const adminId = new Types.ObjectId();
    const password = 'ConcAdmin!StrongPass1';
    const passwordHash = await hashAdminPassword(password);
    const totpSecret = generateSecret();
    const totpSecretEnc = encryptTotpSecret(totpSecret, TOTP_KEY);

    const adminDoc: {
      _id: Types.ObjectId;
      email: string;
      passwordHash: string;
      role: 'moderator';
      totpSecretEnc: string;
      totpEnabled: boolean;
      failedLogins: number;
      lockedUntil?: Date;
      active: boolean;
    } = {
      _id: adminId,
      email: 'conc-totp-burst@mamladibe.org',
      passwordHash,
      role: 'moderator',
      totpSecretEnc,
      totpEnabled: true,
      failedLogins: 0,
      active: true,
    };

    const sessions = new Map<string, Record<string, unknown>>();
    const { findOneSpy } = mockSingleAdminUserAtomic(adminDoc);

    vi.spyOn(AdminSessionModel, 'create').mockImplementation((async (
      doc: Record<string, unknown>,
    ) => {
      const record = { _id: new Types.ObjectId(), ...doc };
      sessions.set(String(doc.sessionHash), record);
      return record;
    }) as never);

    vi.spyOn(AdminSessionModel, 'findOne').mockImplementation(((
      filter: { sessionHash?: string },
    ) => chain(sessions.get(filter.sessionHash ?? '') ?? null)) as never);

    vi.spyOn(AdminSessionModel, 'deleteMany').mockImplementation((async (
      filter: { adminId?: Types.ObjectId; stage?: string },
    ) => {
      let deletedCount = 0;
      for (const [hash, rec] of Array.from(sessions.entries())) {
        const sameAdmin = !filter.adminId || filter.adminId.equals(rec.adminId as Types.ObjectId);
        const sameStage = !filter.stage || rec.stage === filter.stage;
        if (sameAdmin && sameStage) {
          sessions.delete(hash);
          deletedCount += 1;
        }
      }
      return { deletedCount };
    }) as never);

    const auditCreateSpy = vi.spyOn(AuditLogModel, 'create');

    await withServer(async (baseUrl) => {
      const login1 = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': '198.51.100.111',
        },
        body: JSON.stringify({ email: adminDoc.email, password }),
      });
      const login2 = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': '198.51.100.112',
        },
        body: JSON.stringify({ email: adminDoc.email, password }),
      });
      expect(login1.status).toBe(200);
      expect(login2.status).toBe(200);
      const cookie1 = extractAdminCookie(login1)!;
      const cookie2 = extractAdminCookie(login2)!;
      expect(sessions.size).toBe(2);

      // Force all 8 concurrent verify-2fa requests to read the exact same stale
      // user snapshot (failedLogins: 0) before any failure update executes.
      const burstCount = 8;
      let readsAtBarrier = 0;
      let releaseBarrier!: () => void;
      const allReadersArrived = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });

      const baseFindOne = findOneSpy.getMockImplementation()!;
      vi.spyOn(AdminUserModel, 'findOne').mockImplementation(((
        filter: Record<string, unknown>,
      ) => {
        const isInitialRead =
          '_id' in filter && !('lockedUntil' in filter) && readsAtBarrier < burstCount;
        if (!isInitialRead) {
          return baseFindOne(filter);
        }
        readsAtBarrier += 1;
        const snapshot = matchesAdminUserFilter(adminDoc, filter) ? { ...adminDoc } : null;
        if (readsAtBarrier === burstCount) {
          releaseBarrier();
        }
        return {
          select: vi.fn().mockReturnThis(),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          lean: vi.fn().mockImplementation(async () => {
            await allReadersArrived;
            return snapshot;
          }),
        } as never;
      }) as never);

      const validNow = await generateTotp({ secret: totpSecret });
      const badCode = validNow === '000000' ? '111111' : '000000';
      auditCreateSpy.mockClear();

      const responses = await Promise.all(
        Array.from({ length: burstCount }, (_v, idx) =>
          fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: ORIGIN,
              Cookie: idx < 4 ? cookie1 : cookie2,
              'X-Forwarded-For': idx < 4 ? '198.51.100.111' : '198.51.100.112',
            },
            body: JSON.stringify({ code: badCode }),
          }),
        ),
      );

      const statuses = responses.map((r) => r.status);
      const count401 = statuses.filter((s) => s === 401).length;
      const count423 = statuses.filter((s) => s === 423).length;

      expect(count401).toBe(ADMIN.LOGIN_FAILS_BEFORE_LOCK - 1);
      expect(count423).toBe(burstCount - (ADMIN.LOGIN_FAILS_BEFORE_LOCK - 1));
      expect(adminDoc.failedLogins).toBe(0);
      expect(adminDoc.lockedUntil).toBeInstanceOf(Date);
      expect(adminDoc.lockedUntil!.getTime()).toBeGreaterThan(
        Date.now() + (ADMIN.LOCK_MINUTES - 1) * 60_000,
      );
      expect(sessions.size).toBe(0);

      // Subsequent login even with correct password from a fresh IP stays locked.
      const lockedLogin = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': '198.51.100.113',
        },
        body: JSON.stringify({ email: adminDoc.email, password }),
      });
      expect(lockedLogin.status).toBe(423);
      expect(auditCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.login_failed',
          targetId: adminId,
          reason: 'Account locked after repeated failed two-factor verification attempts',
        }),
      );
      expect(auditCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.login_failed',
          targetId: adminId,
          reason: 'Login attempt while admin account is locked',
        }),
      );
    });
  }, 15000);

  it('Phase 2B.1: concurrent mixed password and TOTP failures share threshold 5 without bypass', async () => {
    const adminId = new Types.ObjectId();
    const password = 'MixedConc!StrongPass2';
    const passwordHash = await hashAdminPassword(password);
    const totpSecret = generateSecret();
    const totpSecretEnc = encryptTotpSecret(totpSecret, TOTP_KEY);

    const adminDoc: {
      _id: Types.ObjectId;
      email: string;
      passwordHash: string;
      role: 'moderator';
      totpSecretEnc: string;
      totpEnabled: boolean;
      failedLogins: number;
      lockedUntil?: Date;
      active: boolean;
    } = {
      _id: adminId,
      email: 'conc-mixed@mamladibe.org',
      passwordHash,
      role: 'moderator',
      totpSecretEnc,
      totpEnabled: true,
      failedLogins: 2,
      active: true,
    };

    const sessions = new Map<string, Record<string, unknown>>();
    const { findOneSpy } = mockSingleAdminUserAtomic(adminDoc);

    vi.spyOn(AdminSessionModel, 'create').mockImplementation((async (
      doc: Record<string, unknown>,
    ) => {
      const record = { _id: new Types.ObjectId(), ...doc };
      sessions.set(String(doc.sessionHash), record);
      return record;
    }) as never);

    vi.spyOn(AdminSessionModel, 'findOne').mockImplementation(((
      filter: { sessionHash?: string },
    ) => chain(sessions.get(filter.sessionHash ?? '') ?? null)) as never);

    vi.spyOn(AdminSessionModel, 'deleteMany').mockImplementation((async (
      filter: { adminId?: Types.ObjectId; stage?: string },
    ) => {
      let deletedCount = 0;
      for (const [hash, rec] of Array.from(sessions.entries())) {
        const sameAdmin = !filter.adminId || filter.adminId.equals(rec.adminId as Types.ObjectId);
        const sameStage = !filter.stage || rec.stage === filter.stage;
        if (sameAdmin && sameStage) {
          sessions.delete(hash);
          deletedCount += 1;
        }
      }
      return { deletedCount };
    }) as never);

    await withServer(async (baseUrl) => {
      const loginRes = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': '198.51.100.120',
        },
        body: JSON.stringify({ email: adminDoc.email, password }),
      });
      expect(loginRes.status).toBe(200);
      const pendingCookie = extractAdminCookie(loginRes)!;

      // Barrier across 4 concurrent requests (2 bad passwords + 2 bad TOTP)
      // all starting with stale failedLogins = 2.
      const totalRequests = 4;
      let arrived = 0;
      let openGate!: () => void;
      const gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
      const baseFindOne = findOneSpy.getMockImplementation()!;
      vi.spyOn(AdminUserModel, 'findOne').mockImplementation(((
        filter: Record<string, unknown>,
      ) => {
        if (arrived >= totalRequests) {
          return baseFindOne(filter);
        }
        arrived += 1;
        const snapshot = matchesAdminUserFilter(adminDoc, filter) ? { ...adminDoc } : null;
        if (arrived === totalRequests) {
          openGate();
        }
        return {
          select: vi.fn().mockReturnThis(),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          lean: vi.fn().mockImplementation(async () => {
            await gate;
            return snapshot;
          }),
        } as never;
      }) as never);

      const validNow = await generateTotp({ secret: totpSecret });
      const badCode = validNow === '000000' ? '111111' : '000000';

      const mixedResults = await Promise.all([
        fetch(`${baseUrl}/api/v1/admin/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            'X-Forwarded-For': '198.51.100.121',
          },
          body: JSON.stringify({ email: adminDoc.email, password: 'WrongPassword!1234' }),
        }),
        fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            Cookie: pendingCookie,
            'X-Forwarded-For': '198.51.100.122',
          },
          body: JSON.stringify({ code: badCode }),
        }),
        fetch(`${baseUrl}/api/v1/admin/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            'X-Forwarded-For': '198.51.100.123',
          },
          body: JSON.stringify({ email: adminDoc.email, password: 'WrongPassword!5678' }),
        }),
        fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            Cookie: pendingCookie,
            'X-Forwarded-For': '198.51.100.124',
          },
          body: JSON.stringify({ code: badCode }),
        }),
      ]);

      const mixedStatuses = mixedResults.map((r) => r.status);
      expect(mixedStatuses.filter((s) => s === 401)).toHaveLength(2);
      expect(mixedStatuses.filter((s) => s === 423)).toHaveLength(2);
      expect(adminDoc.failedLogins).toBe(0);
      expect(adminDoc.lockedUntil).toBeInstanceOf(Date);
      expect(adminDoc.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
      expect(sessions.size).toBe(0);
    });
  }, 20000);

  it('Phase 2B.1: concurrent attempts after expired lock reset counter atomically once without losing increments', async () => {
    const adminId = new Types.ObjectId();
    const password = 'ExpiredLock!Strong3';
    const passwordHash = await hashAdminPassword(password);
    const totpSecret = generateSecret();
    const totpSecretEnc = encryptTotpSecret(totpSecret, TOTP_KEY);

    const adminDoc: {
      _id: Types.ObjectId;
      email: string;
      passwordHash: string;
      role: 'moderator';
      totpSecretEnc: string;
      totpEnabled: boolean;
      failedLogins: number;
      lockedUntil?: Date;
      active: boolean;
    } = {
      _id: adminId,
      email: 'conc-expired-lock@mamladibe.org',
      passwordHash,
      role: 'moderator',
      totpSecretEnc,
      totpEnabled: true,
      failedLogins: 0,
      active: true,
    };

    const sessions = new Map<string, Record<string, unknown>>();
    const { findOneSpy, findOneAndUpdateSpy } = mockSingleAdminUserAtomic(adminDoc);

    vi.spyOn(AdminSessionModel, 'create').mockImplementation((async (
      doc: Record<string, unknown>,
    ) => {
      const record = { _id: new Types.ObjectId(), ...doc };
      sessions.set(String(doc.sessionHash), record);
      return record;
    }) as never);

    vi.spyOn(AdminSessionModel, 'findOne').mockImplementation(((
      filter: { sessionHash?: string },
    ) => chain(sessions.get(filter.sessionHash ?? '') ?? null)) as never);

    vi.spyOn(AdminSessionModel, 'deleteMany').mockImplementation((async (
      filter: { adminId?: Types.ObjectId; stage?: string },
    ) => {
      let deletedCount = 0;
      for (const [hash, rec] of Array.from(sessions.entries())) {
        const sameAdmin = !filter.adminId || filter.adminId.equals(rec.adminId as Types.ObjectId);
        const sameStage = !filter.stage || rec.stage === filter.stage;
        if (sameAdmin && sameStage) {
          sessions.delete(hash);
          deletedCount += 1;
        }
      }
      return { deletedCount };
    }) as never);

    await withServer(async (baseUrl) => {
      const loginRes = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': '198.51.100.130',
        },
        body: JSON.stringify({ email: adminDoc.email, password }),
      });
      expect(loginRes.status).toBe(200);
      const pendingCookie = extractAdminCookie(loginRes)!;

      // Simulate an expired lock present when 4 concurrent bad TOTP attempts arrive.
      adminDoc.lockedUntil = new Date(Date.now() - 10_000);
      adminDoc.failedLogins = 0;

      const batchSize = 4;
      let readsAtBarrier = 0;
      let openGate!: () => void;
      const gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
      const baseFindOne = findOneSpy.getMockImplementation()!;
      vi.spyOn(AdminUserModel, 'findOne').mockImplementation(((
        filter: Record<string, unknown>,
      ) => {
        if (readsAtBarrier >= batchSize) {
          return baseFindOne(filter);
        }
        readsAtBarrier += 1;
        const snapshot = matchesAdminUserFilter(adminDoc, filter) ? { ...adminDoc } : null;
        if (readsAtBarrier === batchSize) {
          openGate();
        }
        return {
          select: vi.fn().mockReturnThis(),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          lean: vi.fn().mockImplementation(async () => {
            await gate;
            return snapshot;
          }),
        } as never;
      }) as never);

      const validNow = await generateTotp({ secret: totpSecret });
      const badCode = validNow === '000000' ? '111111' : '000000';

      const batchResults = await Promise.all(
        Array.from({ length: batchSize }, () =>
          fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: ORIGIN,
              Cookie: pendingCookie,
              'X-Forwarded-For': '198.51.100.131',
            },
            body: JSON.stringify({ code: badCode }),
          }),
        ),
      );

      expect(batchResults.every((r) => r.status === 401)).toBe(true);
      expect(adminDoc.failedLogins).toBe(4);
      expect(adminDoc.lockedUntil).toBeUndefined();

      // Confirm expired-lock claim ($unset.lockedUntil) returned non-null exactly once.
      const claimCalls = findOneAndUpdateSpy.mock.calls.filter(([, upd]) =>
        Boolean((upd as AdminUserUpdateOps).$unset && 'lockedUntil' in (upd as AdminUserUpdateOps).$unset!),
      );
      expect(claimCalls.length).toBe(batchSize);

      // 5th bad attempt re-locks the account and revokes pending sessions.
      const fifth = await fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: pendingCookie,
          'X-Forwarded-For': '198.51.100.131',
        },
        body: JSON.stringify({ code: badCode }),
      });
      expect(fifth.status).toBe(423);
      expect(adminDoc.failedLogins).toBe(0);
      expect(adminDoc.lockedUntil).toBeInstanceOf(Date);
      expect(adminDoc.lockedUntil!.getTime()).toBeGreaterThan(
        Date.now() + (ADMIN.LOCK_MINUTES - 1) * 60_000,
      );
      expect(sessions.size).toBe(0);
    });
  }, 15000);

  it('Phase 2B.1: concurrent lockout prevents in-flight valid TOTP promotion from activating session', async () => {
    const adminId = new Types.ObjectId();
    const password = 'PromoteRace!Pass4';
    const passwordHash = await hashAdminPassword(password);
    const totpSecret = generateSecret();
    const totpSecretEnc = encryptTotpSecret(totpSecret, TOTP_KEY);

    const adminDoc: {
      _id: Types.ObjectId;
      email: string;
      passwordHash: string;
      role: 'moderator';
      totpSecretEnc: string;
      totpEnabled: boolean;
      failedLogins: number;
      lockedUntil?: Date;
      lastLoginAt?: Date;
      active: boolean;
    } = {
      _id: adminId,
      email: 'conc-promote-race@mamladibe.org',
      passwordHash,
      role: 'moderator',
      totpSecretEnc,
      totpEnabled: true,
      failedLogins: 0,
      active: true,
    };

    const sessions = new Map<string, Record<string, unknown>>();
    const { findOneAndUpdateSpy } = mockSingleAdminUserAtomic(adminDoc);

    vi.spyOn(AdminSessionModel, 'create').mockImplementation((async (
      doc: Record<string, unknown>,
    ) => {
      const record = { _id: new Types.ObjectId(), ...doc };
      sessions.set(String(doc.sessionHash), record);
      return record;
    }) as never);

    vi.spyOn(AdminSessionModel, 'findOne').mockImplementation(((
      filter: { sessionHash?: string },
    ) => chain(sessions.get(filter.sessionHash ?? '') ?? null)) as never);

    const sessionUpdateSpy = vi
      .spyOn(AdminSessionModel, 'updateOne')
      .mockImplementation((async (
        filter: { _id?: Types.ObjectId; stage?: string },
        update: { $set?: Record<string, unknown> },
      ) => {
        for (const [hash, rec] of Array.from(sessions.entries())) {
          const sameId = filter._id && (rec._id as Types.ObjectId).equals(filter._id);
          const sameStage = !filter.stage || rec.stage === filter.stage;
          if (sameId && sameStage) {
            sessions.delete(hash);
            Object.assign(rec, update.$set ?? {});
            sessions.set(String(rec.sessionHash), rec);
            return { modifiedCount: 1 };
          }
        }
        return { modifiedCount: 0 };
      }) as never);

    vi.spyOn(AdminSessionModel, 'deleteMany').mockImplementation((async (
      filter: { adminId?: Types.ObjectId; stage?: string },
    ) => {
      let deletedCount = 0;
      for (const [hash, rec] of Array.from(sessions.entries())) {
        const sameAdmin = !filter.adminId || filter.adminId.equals(rec.adminId as Types.ObjectId);
        const sameStage = !filter.stage || rec.stage === filter.stage;
        if (sameAdmin && sameStage) {
          sessions.delete(hash);
          deletedCount += 1;
        }
      }
      return { deletedCount };
    }) as never);

    const auditCreateSpy = vi.spyOn(AuditLogModel, 'create');

    await withServer(async (baseUrl) => {
      const loginValid = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': '198.51.100.141',
        },
        body: JSON.stringify({ email: adminDoc.email, password }),
      });
      const loginFail = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Forwarded-For': '198.51.100.142',
        },
        body: JSON.stringify({ email: adminDoc.email, password }),
      });
      expect(loginValid.status).toBe(200);
      expect(loginFail.status).toBe(200);
      const cookieValid = extractAdminCookie(loginValid)!;
      const cookieFail = extractAdminCookie(loginFail)!;

      // Put account 1 failure away from lockout.
      adminDoc.failedLogins = ADMIN.LOGIN_FAILS_BEFORE_LOCK - 1;

      let signalPromotionInFlight!: () => void;
      const promotionInFlight = new Promise<void>((resolve) => {
        signalPromotionInFlight = resolve;
      });
      let releasePromotion!: () => void;
      const promotionReleased = new Promise<void>((resolve) => {
        releasePromotion = resolve;
      });

      const baseFindOneAndUpdate = findOneAndUpdateSpy.getMockImplementation()!;
      vi.spyOn(AdminUserModel, 'findOneAndUpdate').mockImplementation(((
        filter: Record<string, unknown>,
        update: AdminUserUpdateOps,
        options?: { new?: boolean },
      ) => {
        if (update.$set?.totpEnabled === true) {
          // Pause valid TOTP promotion just before MongoDB executes it, so the
          // concurrent 5th failure locks the account first.
          return {
            select: vi.fn().mockReturnThis(),
            sort: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            lean: vi.fn().mockImplementation(async () => {
              signalPromotionInFlight();
              await promotionReleased;
              if (!matchesAdminUserFilter(adminDoc, filter)) {
                return null;
              }
              const before = { ...adminDoc };
              applyAdminUserUpdate(adminDoc, update);
              return options?.new ? { ...adminDoc } : before;
            }),
          } as never;
        }
        return baseFindOneAndUpdate(filter, update, options);
      }) as never);

      const validCode = await generateTotp({ secret: totpSecret });
      const badCode = validCode === '000000' ? '111111' : '000000';
      auditCreateSpy.mockClear();

      const validPromise = fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: cookieValid,
          'X-Forwarded-For': '198.51.100.141',
        },
        body: JSON.stringify({ code: validCode }),
      });

      await promotionInFlight;

      const failRes = await fetch(`${baseUrl}/api/v1/admin/auth/verify-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: cookieFail,
          'X-Forwarded-For': '198.51.100.142',
        },
        body: JSON.stringify({ code: badCode }),
      });
      expect(failRes.status).toBe(423);
      expect(adminDoc.lockedUntil).toBeInstanceOf(Date);

      releasePromotion();
      const validRes = await validPromise;

      expect(validRes.status).toBe(423);
      expect(sessionUpdateSpy).not.toHaveBeenCalled();
      expect(sessions.size).toBe(0);
      expect(auditCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.login_failed',
          targetId: adminId,
          reason: 'Account locked after repeated failed two-factor verification attempts',
        }),
      );
      expect(auditCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.login_failed',
          targetId: adminId,
          reason: 'Two-factor verification aborted because admin account is locked',
        }),
      );

      // Verify cookieValid cannot access authenticated endpoints.
      const meRes = await fetch(`${baseUrl}/api/v1/admin/auth/me`, {
        headers: { Cookie: cookieValid },
      });
      expect(meRes.status).toBe(401);
    });
  }, 15000);
});

