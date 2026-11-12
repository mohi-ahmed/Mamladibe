const MONGO_URI_SECRET_REGEX = /mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi;

/**
 * Normalizes a string using Unicode NFC and trims leading/trailing whitespace.
 * Preserves U+200C (ZWNJ) and U+200D (ZWJ) required for Bangla conjuncts.
 */
export function normalizeUnicodeNfc(value: string): string {
  return value.trim().normalize('NFC');
}

/**
 * Schema setter for required text fields: preserves non-string values so
 * Mongoose type validation rejects them properly.
 */
export function normalizeRequiredText(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  return normalizeUnicodeNfc(value);
}

/**
 * Schema setter for optional text fields: trims + NFC-normalizes strings and
 * converts empty strings to undefined so empty optional fields are omitted.
 */
export function omitEmptyNormalizedText(value: unknown): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const normalized = normalizeUnicodeNfc(value);
  return normalized.length === 0 ? undefined : normalized;
}

/**
 * Counts newline sequences (\n or \r\n) in text.
 */
export function countLineBreaks(value: string): number {
  const normalized = value.replace(/\r\n/g, '\n');
  let count = 0;

  for (let i = 0; i < normalized.length; i += 1) {
    if (normalized[i] === '\n') {
      count += 1;
    }
  }

  return count;
}

/**
 * Removes MongoDB connection strings (and embedded credentials) from arbitrary text.
 */
export function redactMongoUris(text: string): string {
  return text.replace(MONGO_URI_SECRET_REGEX, '[REDACTED_MONGODB_URI]');
}

