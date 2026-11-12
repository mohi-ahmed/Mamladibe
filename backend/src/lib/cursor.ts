import { Types } from 'mongoose';
import { validationError } from '../utils/errors.js';

export interface PaginationCursor {
  createdAt: Date;
  id: Types.ObjectId;
}

export function encodeCursor(createdAt: Date, id: Types.ObjectId): string {
  const payload = JSON.stringify({
    c: createdAt.toISOString(),
    i: id.toString(),
  });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export function decodeCursor(rawCursor: string): PaginationCursor {
  try {
    if (!BASE64URL_PATTERN.test(rawCursor)) {
      throw new Error('Malformed base64url cursor');
    }

    const decoded = Buffer.from(rawCursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Malformed cursor object');
    }

    const record = parsed as { c?: unknown; i?: unknown };

    if (
      typeof record.c !== 'string' ||
      typeof record.i !== 'string' ||
      !OBJECT_ID_HEX_PATTERN.test(record.i)
    ) {
      throw new Error('Malformed cursor payload');
    }

    const createdAt = new Date(record.c);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error('Invalid cursor date');
    }

    return {
      createdAt,
      id: new Types.ObjectId(record.i),
    };
  } catch {
    throw validationError('Invalid pagination cursor.');
  }
}

