import { LIMITS } from '../constants/index.js';
import { validationError } from '../utils/errors.js';
import { sha256Hex } from './crypto.js';

// Removes control chars except \n while preserving U+200C (ZWNJ) & U+200D (ZWJ)
const CONTROL_CHARS_EXCEPT_LF = /[\u0000-\u0009\u000B-\u001F\u007F]/g;
const BIDI_OVERRIDE_CHARS = /[\u202A-\u202E\u2066-\u2069]/g;
const COLLAPSE_EXTRA_NEWLINES = /\n{3,}/g;

const BANGLA_DIGITS: Record<string, string> = {
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9',
};

const URL_PATTERN =
  /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|bd|io|co|info|me|xyz|app|link)\b)/i;
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const BD_PHONE_PATTERN = /(\+?88)?01[3-9]\d{8}/;
const TEN_PLUS_DIGITS_PATTERN = /\d{10,}/;

/**
 * Applies full PRD §9.5 content normalization while keeping U+200C / U+200D intact.
 */
export function normalizeContentText(input: string): string {
  return input
    .normalize('NFC')
    .replace(/\r\n/g, '\n')
    .replace(CONTROL_CHARS_EXCEPT_LF, '')
    .replace(BIDI_OVERRIDE_CHARS, '')
    .trim()
    .replace(COLLAPSE_EXTRA_NEWLINES, '\n\n');
}

export function normalizeOptionalContentText(
  input: string | undefined,
): string | undefined {
  if (input === undefined) {
    return undefined;
  }

  const normalized = normalizeContentText(input);
  return normalized.length === 0 ? undefined : normalized;
}

/**
 * Converts Bangla digits to ASCII and collapses spaces/hyphens/dots between digits
 * before running phone/number rules (PRD §9.5).
 */
export function prepareForDetection(text: string): string {
  const asciiDigits = text.replace(/[০-৯]/g, (digit) => BANGLA_DIGITS[digit] ?? digit);

  let collapsed = asciiDigits;
  let previous: string;
  do {
    previous = collapsed;
    collapsed = collapsed.replace(/(\d)[\s.-]+(\d)/g, '$1$2');
  } while (collapsed !== previous);

  return collapsed;
}

export function containsContactInfo(text: string): boolean {
  const normalized = normalizeContentText(text);
  const prepared = prepareForDetection(normalized);

  return (
    URL_PATTERN.test(normalized) ||
    EMAIL_PATTERN.test(normalized) ||
    BD_PHONE_PATTERN.test(prepared) ||
    TEN_PLUS_DIGITS_PATTERN.test(prepared)
  );
}

export function assertNoContactInfo(
  fields: Record<string, string | undefined>,
): void {
  const violatingFields: string[] = [];

  for (const [field, value] of Object.entries(fields)) {
    if (value !== undefined && containsContactInfo(value)) {
      violatingFields.push(field);
    }
  }

  if (violatingFields.length > 0) {
    throw validationError(
      'Remove personal contact details. Links, email addresses, and phone numbers are not allowed in text fields.',
      {
        reason: 'CONTACT_INFO_NOT_ALLOWED',
        fields: violatingFields.map((path) => ({
          path,
          message: 'Remove personal contact details.',
        })),
      },
    );
  }
}

export function computeIncidentContentHash(input: {
  title: string;
  description: string;
}): string {
  const title = normalizeContentText(input.title);
  const description = normalizeContentText(input.description);

  return sha256Hex(`${title}\n${description}`);
}

export function createExcerpt(
  text: string,
  maxLength: number = LIMITS.EXCERPT_MAX_CHARS,
): string {
  const normalized = normalizeContentText(text).replace(/\s+/g, ' ');
  const codePoints = Array.from(normalized);

  if (codePoints.length <= maxLength) {
    return normalized;
  }

  return `${codePoints.slice(0, Math.max(maxLength - 1, 1)).join('').trimEnd()}…`;
}

