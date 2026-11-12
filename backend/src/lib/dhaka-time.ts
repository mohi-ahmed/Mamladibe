import { RETENTION, TIMEZONE } from '../constants/index.js';

const DHAKA_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DHAKA_UTC_OFFSET_MS = 6 * 60 * 60 * 1000;

export function getDhakaDayKey(date: Date = new Date()): string {
  return DHAKA_DATE_FORMATTER.format(date);
}

export function getUtcDayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Returns the next 00:00:00 in Asia/Dhaka (UTC+06:00, no DST) expressed in UTC.
 */
export function getNextDhakaMidnightUtc(date: Date = new Date()): Date {
  const [yearStr, monthStr, dayStr] = getDhakaDayKey(date).split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  const nextDhakaMidnightAsUtc = Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0);
  return new Date(nextDhakaMidnightAsUtc - DHAKA_UTC_OFFSET_MS);
}

export function getDailyQuotaExpiresAt(date: Date = new Date()): Date {
  return addDays(date, RETENTION.QUOTA_DOC_DAYS);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

