import crypto from 'node:crypto';
import argon2 from 'argon2';
import type { Request } from 'express';
import { ADMIN, COMMON_ADMIN_PASSWORDS } from '../constants/index.js';
import { getDhakaDayKey as _unused, getUtcDayKey } from './dhaka-time.js';

void _unused;

const BROWSER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HEX_64_PATTERN = /^[0-9a-f]{64}$/i;
const HEX_ANY_PATTERN = /^[0-9a-f]+$/i;
const TOTP_CIPHERTEXT_PREFIX = 'v1';

export function generateBrowserToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function isValidBrowserToken(token: unknown): token is string {
  return typeof token === 'string' && BROWSER_TOKEN_PATTERN.test(token);
}

export function computeActorId(rawToken: string, actorSecret: string): string {
  if (!rawToken || !actorSecret) {
    throw new Error('Actor token and secret are required to compute actorId.');
  }

  return crypto
    .createHmac('sha256', actorSecret)
    .update(rawToken, 'utf8')
    .digest('hex')
    .slice(0, 32);
}

export function extractClientIp(
  req: Pick<Request, 'headers' | 'ip' | 'socket'>,
): string {
  const forwarded = req.headers['x-forwarded-for'];
  const firstForwarded =
    typeof forwarded === 'string'
      ? forwarded.split(',')[0]?.trim()
      : Array.isArray(forwarded)
        ? forwarded[0]?.split(',')[0]?.trim()
        : undefined;

  const rawIp =
    (firstForwarded && firstForwarded.length > 0 ? firstForwarded : undefined) ??
    req.ip ??
    req.socket?.remoteAddress ??
    '0.0.0.0';

  return rawIp.replace(/^::ffff:/, '').trim() || '0.0.0.0';
}

export function computeIpHash(
  ip: string,
  ipSecret: string,
  now: Date = new Date(),
): string {
  if (!ipSecret) {
    throw new Error('IP_HMAC_SECRET is required to compute ipHash.');
  }

  const utcDay = getUtcDayKey(now);
  return crypto
    .createHmac('sha256', `${ipSecret}:${utcDay}`)
    .update(ip, 'utf8')
    .digest('hex')
    .slice(0, 32);
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  if (
    a.length === 0 ||
    a.length !== b.length ||
    a.length % 2 !== 0 ||
    !HEX_ANY_PATTERN.test(a) ||
    !HEX_ANY_PATTERN.test(b)
  ) {
    return false;
  }

  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

export function constantTimeEqualUtf8(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function deriveAes256Key(keyMaterial: string): Buffer {
  const trimmed = keyMaterial.trim();
  if (HEX_64_PATTERN.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  const base64Decoded = Buffer.from(trimmed, 'base64');
  if (
    base64Decoded.length === 32 &&
    base64Decoded.toString('base64').replace(/=+$/, '') ===
      trimmed.replace(/=+$/, '')
  ) {
    return base64Decoded;
  }

  if (Buffer.byteLength(trimmed, 'utf8') >= 32) {
    return crypto.createHash('sha256').update(trimmed, 'utf8').digest();
  }

  throw new Error(
    'TOTP_ENC_KEY must be a 64-char hex key, 32-byte base64 key, or >= 32-char secret.',
  );
}

export function isValidTotpKeyMaterial(keyMaterial: string): boolean {
  try {
    deriveAes256Key(keyMaterial);
    return true;
  } catch {
    return false;
  }
}

export function encryptTotpSecret(
  plainSecret: string,
  keyMaterial: string,
): string {
  const key = deriveAes256Key(keyMaterial);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plainSecret, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    TOTP_CIPHERTEXT_PREFIX,
    iv.toString('hex'),
    tag.toString('hex'),
    ciphertext.toString('hex'),
  ].join(':');
}

export function decryptTotpSecret(
  encryptedPayload: string,
  keyMaterial: string,
): string {
  const parts = encryptedPayload.split(':');
  if (parts.length !== 4 || parts[0] !== TOTP_CIPHERTEXT_PREFIX) {
    throw new Error('Malformed encrypted TOTP payload.');
  }

  const [, ivHex, tagHex, cipherHex] = parts;
  if (!ivHex || !tagHex || !cipherHex) {
    throw new Error('Incomplete encrypted TOTP payload.');
  }

  const key = deriveAes256Key(keyMaterial);
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(cipherHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return plain.toString('utf8');
}

export function validateAdminPasswordStrength(
  password: string,
  email?: string,
): void {
  if (password.length < ADMIN.PASSWORD_MIN) {
    throw new Error(
      `Admin password must be at least ${ADMIN.PASSWORD_MIN} characters long.`,
    );
  }

  const lower = password.toLowerCase();
  if (COMMON_ADMIN_PASSWORDS.includes(lower)) {
    throw new Error('Password is too common. Choose a stronger password.');
  }

  if (/^(.)\1+$/.test(password)) {
    throw new Error('Password cannot consist of a single repeated character.');
  }

  if (email) {
    const localPart = email.split('@')[0]?.trim().toLowerCase();
    if (localPart && localPart.length >= 4 && lower.includes(localPart)) {
      throw new Error('Password must not contain your email username.');
    }
  }
}

export async function hashAdminPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyAdminPassword(
  storedHash: string,
  candidatePassword: string,
): Promise<boolean> {
  if (!storedHash || !candidatePassword) {
    return false;
  }

  try {
    return await argon2.verify(storedHash, candidatePassword);
  } catch {
    return false;
  }
}

