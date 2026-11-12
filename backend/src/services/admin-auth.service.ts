import { generateURI, verify as verifyTotp } from 'otplib';
import QRCode from 'qrcode';
import type { Types } from 'mongoose';
import { getRequiredEnvSecret } from '../config/env.js';
import { ADMIN, PATTERNS } from '../constants/index.js';
import {
  decryptTotpSecret,
  generateCsrfToken,
  generateSessionToken,
  sha256Hex,
  verifyAdminPassword,
} from '../lib/crypto.js';
import { addHours, addMinutes } from '../lib/dhaka-time.js';
import {
  claimTotpReplayWindow,
  clearPending2faSessionFailures,
  consumeAdminLoginRateLimit,
  consumePending2faSessionFailure,
} from '../lib/ratelimit.js';
import { AdminSessionModel, AdminUserModel } from '../models/index.js';
import type { AuthenticatedAdminContext, IAdminUser } from '../types/index.js';
import {
  internalError,
  lockedError,
  unauthorizedError,
} from '../utils/errors.js';
import { recordAbuseSignal } from './abuse-signal.service.js';
import { writeAuditLog } from './admin-audit.service.js';

type AdminUserWithSecrets = IAdminUser & { _id: Types.ObjectId };

function getActiveLockRetryAfterSeconds(
  lockedUntil: Date | undefined,
  now: Date,
): number | null {
  if (!lockedUntil || lockedUntil.getTime() <= now.getTime()) {
    return null;
  }
  return Math.max(Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000), 1);
}

function notLockedCondition(now: Date) {
  return {
    $or: [
      { lockedUntil: { $exists: false } },
      { lockedUntil: null },
      { lockedUntil: { $lte: now } },
    ],
  };
}

async function revokePending2faSessionsForAdmin(
  adminId: Types.ObjectId,
  sessionId?: Types.ObjectId,
  onSessionRevoked?: () => void,
): Promise<void> {
  await Promise.all([
    AdminSessionModel.deleteMany({ adminId, stage: 'pending_2fa' }),
    ...(sessionId
      ? [clearPending2faSessionFailures(sessionId.toString())]
      : []),
  ]);
  onSessionRevoked?.();
}

async function handleFailedAdminAuthAttempt(params: {
  user: AdminUserWithSecrets;
  ipHash: string;
  now: Date;
  auditReason: string;
  lockReason: string;
  failureMessage: string;
  lockMessage: string;
  pendingSessionId?: Types.ObjectId;
  onSessionRevoked?: () => void;
}): Promise<never> {
  const {
    user,
    ipHash,
    now,
    auditReason,
    lockReason,
    failureMessage,
    lockMessage,
    pendingSessionId,
    onSessionRevoked,
  } = params;

  // Step 1: Atomically claim an expired lock transition once (sets failedLogins=1, unsets lockedUntil).
  let updatedUser = (await AdminUserModel.findOneAndUpdate(
    {
      _id: user._id,
      active: true,
      lockedUntil: { $lte: now },
    },
    {
      $set: { failedLogins: 1 },
      $unset: { lockedUntil: 1 },
    },
    { new: true },
  ).lean()) as AdminUserWithSecrets | null;

  // Step 2: Otherwise atomically increment the shared counter while unlocked so concurrent fails cannot be lost.
  if (!updatedUser) {
    updatedUser = (await AdminUserModel.findOneAndUpdate(
      {
        _id: user._id,
        active: true,
        ...notLockedCondition(now),
      },
      {
        $inc: { failedLogins: 1 },
      },
      { new: true },
    ).lean()) as AdminUserWithSecrets | null;
  }

  // If neither matched, a concurrent request already locked or deactivated this account.
  if (!updatedUser) {
    const latest = (await AdminUserModel.findOne({ _id: user._id })
      .select('active lockedUntil')
      .lean()) as Pick<AdminUserWithSecrets, 'active' | 'lockedUntil'> | null;

    if (!latest || !latest.active) {
      if (pendingSessionId) {
        await revokePending2faSessionsForAdmin(
          user._id,
          pendingSessionId,
          onSessionRevoked,
        );
      }
      await Promise.all([
        recordAbuseSignal({ ipHash, type: 'admin_login_failed' }),
        writeAuditLog({
          adminId: user._id,
          action: 'auth.login_failed',
          targetType: 'admin_user',
          targetId: user._id,
          reason: auditReason,
          createdAt: now,
        }),
      ]);
      throw unauthorizedError(failureMessage);
    }

    const activeLockSeconds = getActiveLockRetryAfterSeconds(latest.lockedUntil, now);
    if (activeLockSeconds !== null) {
      await Promise.all([
        revokePending2faSessionsForAdmin(
          user._id,
          pendingSessionId,
          onSessionRevoked,
        ),
        recordAbuseSignal({ ipHash, type: 'admin_login_failed' }),
        writeAuditLog({
          adminId: user._id,
          action: 'auth.login_failed',
          targetType: 'admin_user',
          targetId: user._id,
          reason: lockReason,
          createdAt: now,
        }),
      ]);
      throw lockedError(lockMessage, {
        retryAfterSeconds: activeLockSeconds,
      });
    }

    await Promise.all([
      recordAbuseSignal({ ipHash, type: 'admin_login_failed' }),
      writeAuditLog({
        adminId: user._id,
        action: 'auth.login_failed',
        targetType: 'admin_user',
        targetId: user._id,
        reason: auditReason,
        createdAt: now,
      }),
    ]);
    throw unauthorizedError(failureMessage);
  }

  const sessionFail = pendingSessionId
    ? await consumePending2faSessionFailure(pendingSessionId.toString())
    : null;

  if ((updatedUser.failedLogins ?? 0) >= ADMIN.LOGIN_FAILS_BEFORE_LOCK) {
    const lockUntil = addMinutes(now, ADMIN.LOCK_MINUTES);

    await Promise.all([
      AdminUserModel.findOneAndUpdate(
        {
          _id: user._id,
          failedLogins: { $gte: ADMIN.LOGIN_FAILS_BEFORE_LOCK },
          ...notLockedCondition(now),
        },
        {
          $set: {
            failedLogins: 0,
            lockedUntil: lockUntil,
          },
        },
        { new: true },
      ).lean(),
      revokePending2faSessionsForAdmin(
        user._id,
        pendingSessionId,
        onSessionRevoked,
      ),
      recordAbuseSignal({
        ipHash,
        type: 'admin_login_failed',
      }),
      writeAuditLog({
        adminId: user._id,
        action: 'auth.login_failed',
        targetType: 'admin_user',
        targetId: user._id,
        reason: lockReason,
        createdAt: now,
      }),
    ]);

    throw lockedError(lockMessage, {
      retryAfterSeconds: ADMIN.LOCK_MINUTES * 60,
    });
  }

  if (pendingSessionId && sessionFail?.exhausted) {
    await Promise.all([
      AdminSessionModel.deleteOne({ _id: pendingSessionId }),
      clearPending2faSessionFailures(pendingSessionId.toString()),
      recordAbuseSignal({
        ipHash,
        type: 'admin_login_failed',
      }),
      writeAuditLog({
        adminId: user._id,
        action: 'auth.login_failed',
        targetType: 'admin_user',
        targetId: user._id,
        reason: 'Pending 2FA session revoked after maximum failed TOTP attempts',
        createdAt: now,
      }),
    ]);
    onSessionRevoked?.();
    throw unauthorizedError(
      'Too many failed verification attempts for this session. Please sign in again.',
    );
  }

  await Promise.all([
    recordAbuseSignal({
      ipHash,
      type: 'admin_login_failed',
    }),
    writeAuditLog({
      adminId: user._id,
      action: 'auth.login_failed',
      targetType: 'admin_user',
      targetId: user._id,
      reason: auditReason,
      createdAt: now,
    }),
  ]);

  throw unauthorizedError(failureMessage);
}

export async function loginAdminWithPassword(
  email: string,
  password: string,
  context: { ipHash?: string },
) {
  if (!context.ipHash || !PATTERNS.IP_HASH_HEX.test(context.ipHash)) {
    throw internalError('IP hash is required for admin authentication.', 500);
  }
  await consumeAdminLoginRateLimit(context.ipHash);

  const normalizedEmail = email.trim().toLowerCase();
  const user = (await AdminUserModel.findOne({ email: normalizedEmail })
    .select('+passwordHash +totpSecretEnc')
    .lean()) as AdminUserWithSecrets | null;

  const now = new Date();

  if (!user || !user.active) {
    await Promise.all([
      recordAbuseSignal({
        ipHash: context.ipHash,
        type: 'admin_login_failed',
      }),
      ...(user && !user.active
        ? [
            writeAuditLog({
              adminId: user._id,
              action: 'auth.login_failed',
              targetType: 'admin_user',
              targetId: user._id,
              reason: 'Login attempt on inactive admin account',
              createdAt: now,
            }),
          ]
        : []),
    ]);
    throw unauthorizedError('Invalid credentials.');
  }

  const lockRetryAfterSeconds = getActiveLockRetryAfterSeconds(user.lockedUntil, now);
  if (lockRetryAfterSeconds !== null) {
    await Promise.all([
      recordAbuseSignal({
        ipHash: context.ipHash,
        type: 'admin_login_failed',
      }),
      writeAuditLog({
        adminId: user._id,
        action: 'auth.login_failed',
        targetType: 'admin_user',
        targetId: user._id,
        reason: 'Login attempt while admin account is locked',
        createdAt: now,
      }),
    ]);
    throw lockedError('Account temporarily locked due to failed login attempts.', {
      retryAfterSeconds: lockRetryAfterSeconds,
    });
  }

  const passwordValid = await verifyAdminPassword(user.passwordHash, password);
  if (!passwordValid) {
    return handleFailedAdminAuthAttempt({
      user,
      ipHash: context.ipHash,
      now,
      auditReason: 'Invalid password attempt',
      lockReason: 'Account locked after repeated failed password attempts',
      failureMessage: 'Invalid credentials.',
      lockMessage: 'Too many failed login attempts. Account is temporarily locked.',
    });
  }

  // Conditionally clear expired lock state only; never reset shared failedLogins before 2FA succeeds.
  if (user.lockedUntil && user.lockedUntil.getTime() <= now.getTime()) {
    await AdminUserModel.findOneAndUpdate(
      {
        _id: user._id,
        lockedUntil: { $lte: now },
      },
      {
        $set: { failedLogins: 0 },
        $unset: { lockedUntil: 1 },
      },
      { new: true },
    ).lean();
  }

  const rawSessionToken = generateSessionToken();
  const csrfToken = generateCsrfToken();
  const pendingExpiresAt = addMinutes(now, ADMIN.PENDING_2FA_WINDOW_MINUTES);

  await AdminSessionModel.create({
    adminId: user._id,
    sessionHash: sha256Hex(rawSessionToken),
    stage: 'pending_2fa',
    csrfToken,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: pendingExpiresAt,
  });

  let totpSetup:
    | { qrDataUrl: string; manualKey: string }
    | undefined;

  if (!user.totpEnabled) {
    const totpKey = getRequiredEnvSecret('TOTP_ENC_KEY');
    const plainTotpSecret = decryptTotpSecret(user.totpSecretEnc, totpKey);
    const otpauthUri = generateURI({
      issuer: 'Mamladibe Admin',
      label: user.email,
      secret: plainTotpSecret,
    });
    const qrDataUrl = await QRCode.toDataURL(otpauthUri);
    totpSetup = {
      qrDataUrl,
      manualKey: plainTotpSecret,
    };
  }

  return {
    rawSessionToken,
    pendingExpiresAt,
    pending2fa: true as const,
    requires2faSetup: !user.totpEnabled,
    ...(totpSetup ? { totpSetup } : {}),
  };
}

export async function verifyAdminTwoFactor(
  sessionCtx: AuthenticatedAdminContext,
  code: string,
  context: { ipHash?: string; onSessionRevoked?: () => void },
) {
  if (!context.ipHash || !PATTERNS.IP_HASH_HEX.test(context.ipHash)) {
    throw internalError('IP hash is required for 2FA verification.', 500);
  }
  await consumeAdminLoginRateLimit(context.ipHash);

  const now = new Date();
  const user = (await AdminUserModel.findOne({
    _id: sessionCtx.adminId,
  })
    .select('+totpSecretEnc')
    .lean()) as AdminUserWithSecrets | null;

  if (!user || !user.active) {
    await Promise.all([
      revokePending2faSessionsForAdmin(
        sessionCtx.adminId,
        sessionCtx.sessionId,
        context.onSessionRevoked,
      ),
      recordAbuseSignal({
        ipHash: context.ipHash,
        type: 'admin_login_failed',
      }),
      ...(user && !user.active
        ? [
            writeAuditLog({
              adminId: user._id,
              action: 'auth.login_failed',
              targetType: 'admin_user',
              targetId: user._id,
              reason: 'Two-factor verification attempt on inactive admin account',
              createdAt: now,
            }),
          ]
        : []),
    ]);
    throw unauthorizedError('Admin account is inactive or unavailable.');
  }

  const lockRetryAfterSeconds = getActiveLockRetryAfterSeconds(user.lockedUntil, now);
  if (lockRetryAfterSeconds !== null) {
    await Promise.all([
      revokePending2faSessionsForAdmin(
        user._id,
        sessionCtx.sessionId,
        context.onSessionRevoked,
      ),
      recordAbuseSignal({
        ipHash: context.ipHash,
        type: 'admin_login_failed',
      }),
      writeAuditLog({
        adminId: user._id,
        action: 'auth.login_failed',
        targetType: 'admin_user',
        targetId: user._id,
        reason: 'Two-factor verification attempt while admin account is locked',
        createdAt: now,
      }),
    ]);
    throw lockedError('Account temporarily locked due to failed login attempts.', {
      retryAfterSeconds: lockRetryAfterSeconds,
    });
  }

  const totpKey = getRequiredEnvSecret('TOTP_ENC_KEY');
  const plainTotpSecret = decryptTotpSecret(user.totpSecretEnc, totpKey);

  const verifyResult = await verifyTotp({
    secret: plainTotpSecret,
    token: code,
    epochTolerance: 30,
  });

  if (!verifyResult.valid) {
    return handleFailedAdminAuthAttempt({
      user,
      ipHash: context.ipHash,
      now,
      auditReason: 'Invalid TOTP verification code',
      lockReason: 'Account locked after repeated failed two-factor verification attempts',
      failureMessage: 'Invalid verification code.',
      lockMessage: 'Too many failed verification attempts. Account is temporarily locked.',
      pendingSessionId: sessionCtx.sessionId,
      onSessionRevoked: context.onSessionRevoked,
    });
  }

  const freshCode = await claimTotpReplayWindow(user._id.toString(), code);
  if (!freshCode) {
    return handleFailedAdminAuthAttempt({
      user,
      ipHash: context.ipHash,
      now,
      auditReason: 'Replayed TOTP verification code',
      lockReason: 'Account locked after repeated failed two-factor verification attempts',
      failureMessage: 'Verification code has already been used. Wait for the next code.',
      lockMessage: 'Too many failed verification attempts. Account is temporarily locked.',
      pendingSessionId: sessionCtx.sessionId,
      onSessionRevoked: context.onSessionRevoked,
    });
  }

  const nextRawSessionToken = generateSessionToken();
  const nextCsrfToken = generateCsrfToken();
  const expiresAt = addHours(now, ADMIN.SESSION_ABSOLUTE_HOURS);

  // Atomically verify account remains active, unlocked, and below threshold before promoting session.
  const promotedUser = (await AdminUserModel.findOneAndUpdate(
    {
      _id: user._id,
      active: true,
      failedLogins: { $lt: ADMIN.LOGIN_FAILS_BEFORE_LOCK },
      ...notLockedCondition(now),
    },
    {
      $set: {
        totpEnabled: true,
        lastLoginAt: now,
        failedLogins: 0,
      },
      $unset: { lockedUntil: 1 },
    },
    { new: true },
  ).lean()) as AdminUserWithSecrets | null;

  if (!promotedUser) {
    const latest = (await AdminUserModel.findOne({ _id: user._id })
      .select('active lockedUntil')
      .lean()) as Pick<AdminUserWithSecrets, 'active' | 'lockedUntil'> | null;

    await Promise.all([
      revokePending2faSessionsForAdmin(
        user._id,
        sessionCtx.sessionId,
        context.onSessionRevoked,
      ),
      recordAbuseSignal({
        ipHash: context.ipHash,
        type: 'admin_login_failed',
      }),
    ]);

    if (!latest || !latest.active) {
      if (latest) {
        await writeAuditLog({
          adminId: user._id,
          action: 'auth.login_failed',
          targetType: 'admin_user',
          targetId: user._id,
          reason: 'Two-factor verification aborted because admin account is inactive',
          createdAt: now,
        });
      }
      throw unauthorizedError('Admin account is inactive or unavailable.');
    }

    const retrySeconds =
      getActiveLockRetryAfterSeconds(latest.lockedUntil, now) ??
      ADMIN.LOCK_MINUTES * 60;
    await writeAuditLog({
      adminId: user._id,
      action: 'auth.login_failed',
      targetType: 'admin_user',
      targetId: user._id,
      reason: 'Two-factor verification aborted because admin account is locked',
      createdAt: now,
    });
    throw lockedError('Account temporarily locked due to failed login attempts.', {
      retryAfterSeconds: retrySeconds,
    });
  }

  await Promise.all([
    AdminSessionModel.updateOne(
      { _id: sessionCtx.sessionId, stage: 'pending_2fa' },
      {
        $set: {
          sessionHash: sha256Hex(nextRawSessionToken),
          stage: 'active',
          csrfToken: nextCsrfToken,
          lastSeenAt: now,
          expiresAt,
        },
      },
    ),
    clearPending2faSessionFailures(sessionCtx.sessionId.toString()),
    writeAuditLog({
      adminId: user._id,
      action: 'auth.login',
      targetType: 'admin_user',
      targetId: user._id,
      createdAt: now,
    }),
  ]);

  return {
    rawSessionToken: nextRawSessionToken,
    csrfToken: nextCsrfToken,
    admin: {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
    },
  };
}

export async function logoutAdminSession(
  sessionCtx: AuthenticatedAdminContext,
) {
  await Promise.all([
    AdminSessionModel.deleteOne({ _id: sessionCtx.sessionId }),
    writeAuditLog({
      adminId: sessionCtx.adminId,
      action: 'auth.logout',
      targetType: 'admin_user',
      targetId: sessionCtx.adminId,
    }),
  ]);

  return { loggedOut: true };
}

export function getAdminSessionMe(sessionCtx: AuthenticatedAdminContext) {
  return {
    admin: {
      id: sessionCtx.adminId.toString(),
      email: sessionCtx.email,
      role: sessionCtx.role,
    },
    csrfToken: sessionCtx.csrfToken,
  };
}

