import crypto from 'node:crypto';
import { PATTERNS } from '../constants/index.js';
import { constantTimeEqualHex, sha256Hex } from './crypto.js';

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const NORMALIZED_SECRET_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function generateTrackingId(): string {
  let code = '';
  for (let i = 0; i < 8; i += 1) {
    code += CROCKFORD_ALPHABET[crypto.randomInt(0, CROCKFORD_ALPHABET.length)];
  }
  return `MD-${code}`;
}

export function isValidTrackingId(value: string): boolean {
  return PATTERNS.TRACKING_ID.test(value.trim().toUpperCase());
}

export function encodeCrockfordBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      output += CROCKFORD_ALPHABET[(value >>> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    output += CROCKFORD_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return output;
}

export function formatReporterSecret(normalizedSecret: string): string {
  const groups = normalizedSecret.match(/.{1,5}/g);
  return groups ? groups.join('-') : normalizedSecret;
}

export function normalizeReporterSecret(input: string): string {
  return input
    .replace(/[\s-]+/g, '')
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

export function isValidReporterSecretInput(input: string): boolean {
  return NORMALIZED_SECRET_PATTERN.test(normalizeReporterSecret(input));
}

export function hashReporterSecret(input: string): string {
  const normalized = normalizeReporterSecret(input);
  return sha256Hex(normalized);
}

export function verifyReporterSecret(
  candidateInput: string,
  storedSecretHash: string,
): boolean {
  const normalized = normalizeReporterSecret(candidateInput);
  if (!NORMALIZED_SECRET_PATTERN.test(normalized)) {
    return false;
  }

  const candidateHash = sha256Hex(normalized);
  return constantTimeEqualHex(candidateHash, storedSecretHash);
}

export function generateReporterSecret(): {
  rawSecret: string;
  formattedSecret: string;
  secretHash: string;
} {
  const rawSecret = encodeCrockfordBase32(crypto.randomBytes(16));
  const formattedSecret = formatReporterSecret(rawSecret);
  const secretHash = sha256Hex(rawSecret);

  return {
    rawSecret,
    formattedSecret,
    secretHash,
  };
}

