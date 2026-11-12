import { describe, expect, it } from 'vitest';
import {
  computeActorId,
  computeIpHash,
  constantTimeEqualHex,
  decryptTotpSecret,
  encryptTotpSecret,
  extractClientIp,
  generateBrowserToken,
  hashAdminPassword,
  isValidBrowserToken,
  sha256Hex,
  validateAdminPasswordStrength,
  verifyAdminPassword,
} from '../../src/lib/crypto.js';
import {
  getDhakaDayKey,
  getNextDhakaMidnightUtc,
} from '../../src/lib/dhaka-time.js';
import {
  computeChangeRatio,
  levenshteinDistance,
} from '../../src/lib/levenshtein.js';
import {
  assertNoContactInfo,
  computeIncidentContentHash,
  containsContactInfo,
  normalizeContentText,
  prepareForDetection,
} from '../../src/lib/text-rules.js';
import {
  formatReporterSecret,
  generateReporterSecret,
  generateTrackingId,
  isValidTrackingId,
  normalizeReporterSecret,
  verifyReporterSecret,
} from '../../src/lib/tracking.js';

describe('T01 backend core utilities', () => {
  describe('crypto helpers', () => {
    it('generates valid 256-bit base64url browser tokens and deterministic 32-hex actorIds', () => {
      const token = generateBrowserToken();
      expect(isValidBrowserToken(token)).toBe(true);
      expect(token).toHaveLength(43);

      const actor1 = computeActorId(token, 'actor-secret-test');
      const actor2 = computeActorId(token, 'actor-secret-test');
      const actorDifferent = computeActorId(token, 'other-secret');

      expect(actor1).toMatch(/^[0-9a-f]{32}$/);
      expect(actor1).toBe(actor2);
      expect(actor1).not.toBe(actorDifferent);
    });

    it('rotates IP hashes daily in UTC and extracts x-forwarded-for safely', () => {
      const ip = extractClientIp({
        headers: { 'x-forwarded-for': '::ffff:203.0.113.10, 10.0.0.1' },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      } as never);
      expect(ip).toBe('203.0.113.10');

      const day1 = computeIpHash(
        ip,
        'ip-secret',
        new Date('2026-11-10T23:59:00.000Z'),
      );
      const day2 = computeIpHash(
        ip,
        'ip-secret',
        new Date('2026-11-11T00:01:00.000Z'),
      );
      expect(day1).toMatch(/^[0-9a-f]{32}$/);
      expect(day1).not.toBe(day2);
    });

    it('encrypts and decrypts TOTP secrets using AES-256-GCM and enforces constant-time hex compare', () => {
      const key = '0123456789abcdef'.repeat(4);
      const encrypted = encryptTotpSecret('JBSWY3DPEHPK3PXP', key);
      expect(encrypted.startsWith('v1:')).toBe(true);
      expect(decryptTotpSecret(encrypted, key)).toBe('JBSWY3DPEHPK3PXP');

      const h = sha256Hex('sample');
      expect(constantTimeEqualHex(h, h)).toBe(true);
      expect(constantTimeEqualHex(h, '0'.repeat(64))).toBe(false);
    });

    it('validates admin password strength and hashes/verifies with Argon2id', async () => {
      expect(() => validateAdminPasswordStrength('short')).toThrow();
      expect(() =>
        validateAdminPasswordStrength('password123456', 'ops@mamladibe.org'),
      ).toThrow();
      expect(() =>
        validateAdminPasswordStrength('myopsname123456', 'myopsname@mamladibe.org'),
      ).toThrow();

      const strong = 'Correct-Horse-Dhaka-Battery-99!';
      validateAdminPasswordStrength(strong, 'ops@mamladibe.org');
      const digest = await hashAdminPassword(strong);
      expect(digest.startsWith('$argon2id$')).toBe(true);
      expect(await verifyAdminPassword(digest, strong)).toBe(true);
      expect(await verifyAdminPassword(digest, 'wrong-password-123')).toBe(false);
    });
  });

  describe('tracking ID and reporter secret helpers', () => {
    it('generates valid MD-trackingIds and Crockford Base32 secrets with typo-tolerant verification', () => {
      const trackingId = generateTrackingId();
      expect(isValidTrackingId(trackingId)).toBe(true);

      const { rawSecret, formattedSecret, secretHash } = generateReporterSecret();
      expect(rawSecret).toHaveLength(26);
      expect(formatReporterSecret(rawSecret)).toBe(formattedSecret);
      expect(secretHash).toMatch(/^[0-9a-f]{64}$/);
      expect(verifyReporterSecret(formattedSecret, secretHash)).toBe(true);

      // Map ambiguous I/L -> 1, O -> 0 and ignore spaces/lowercase
      const typoVariant = formattedSecret
        .toLowerCase()
        .replace(/1/g, 'l')
        .replace(/0/g, 'o')
        .replace(/-/g, ' ');
      expect(normalizeReporterSecret(typoVariant)).toBe(rawSecret);
      expect(verifyReporterSecret(typoVariant, secretHash)).toBe(true);
      expect(verifyReporterSecret('wrong-secret-value', secretHash)).toBe(false);
    });
  });

  describe('text normalization, contact rules, and Levenshtein', () => {
    it('preserves Bangla ZWJ/ZWNJ, collapses excess newlines, strips bidi overrides', () => {
      const input = '  ঢাকা\u200Dতে   \r\n\r\n\r\n  যানজট\u200C ও\u202E সতর্কতা  ';
      const normalized = normalizeContentText(input);
      expect(normalized).toContain('\u200D');
      expect(normalized).toContain('\u200C');
      expect(normalized).not.toContain('\u202E');
      expect(normalized).not.toContain('\n\n\n');
    });

    it('detects URLs, emails, English phones, Bangla digit phones, and 10+ digit runs', () => {
      expect(containsContactInfo('Check https://example.com right now')).toBe(true);
      expect(containsContactInfo('Visit facebook.com/page for news')).toBe(true);
      expect(containsContactInfo('Mail user@example.org anytime')).toBe(true);
      expect(prepareForDetection('কল করুন ০১৭১১-১২৩৪৫৬')).toContain('01711123456');
      expect(containsContactInfo('কল করুন ০১৭১১-১২৩৪৫৬')).toBe(true);
      expect(containsContactInfo('Number is 01812 34 56 78')).toBe(true);
      expect(containsContactInfo('Heavy waterlogging near Mirpur 10 signal.')).toBe(
        false,
      );

      expect(() =>
        assertNoContactInfo({
          title: 'Safe road report title',
          description: 'Call ০১৯১১১২৩৪৫৬ immediately after seeing traffic',
        }),
      ).toThrowError(/Remove personal contact details/);
    });

    it('computes contentHash per PRD (normalized title + newline + description) and Unicode-aware Levenshtein ratio', () => {
      const title = '  Traffic jam at Farmgate\r\n';
      const description = 'Heavy congestion towards\r\n\r\n\r\nKarwan Bazar since morning.';
      const expected = sha256Hex(
        `${normalizeContentText(title)}\n${normalizeContentText(description)}`,
      );

      const h1 = computeIncidentContentHash({ title, description });
      const h2 = computeIncidentContentHash({
        title: 'Traffic jam at Farmgate',
        description: 'Heavy congestion towards\n\nKarwan Bazar since morning.',
      });
      expect(h1).toBe(expected);
      expect(h1).toBe(h2);

      expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
      expect(computeChangeRatio('1234567890', '123456789X')).toBeCloseTo(0.1);
      expect(computeChangeRatio('ঢাকা', 'ঢাক')).toBeCloseTo(0.25);
    });
  });

  describe('Asia/Dhaka day and quota midnight calculation', () => {
    it('computes Asia/Dhaka YYYY-MM-DD and exact 00:00 Dhaka (18:00 UTC) reset timestamp', () => {
      // 2026-11-10T17:59:59Z is 2026-11-10T23:59:59+06:00 -> Dhaka day 2026-11-10
      const beforeMidnight = new Date('2026-11-10T17:59:59.000Z');
      expect(getDhakaDayKey(beforeMidnight)).toBe('2026-11-10');
      expect(getNextDhakaMidnightUtc(beforeMidnight).toISOString()).toBe(
        '2026-11-10T18:00:00.000Z',
      );

      // 2026-11-10T18:00:01Z is 2026-11-11T00:00:01+06:00 -> Dhaka day 2026-11-11
      const afterMidnight = new Date('2026-11-10T18:00:01.000Z');
      expect(getDhakaDayKey(afterMidnight)).toBe('2026-11-11');
      expect(getNextDhakaMidnightUtc(afterMidnight).toISOString()).toBe(
        '2026-11-11T18:00:00.000Z',
      );
    });
  });
});
