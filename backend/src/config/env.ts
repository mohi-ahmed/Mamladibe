import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { PATTERNS } from '../constants/index.js';
import { isValidTotpKeyMaterial } from '../lib/crypto.js';
import type { LogLevel } from '../lib/logger.js';

export interface LocalDevEnvOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  preExistingKeys?: ReadonlySet<string>;
  exists?: (filePath: string) => boolean;
  readFile?: (filePath: string) => string;
}

/**
 * Loads `.env.local` overrides solely in local development (`NODE_ENV === 'development'`)
 * while preserving explicit process/shell environment variables.
 */
export function applyLocalDevEnvOverrides(options: LocalDevEnvOptions = {}): boolean {
  const targetEnv = options.env ?? process.env;
  const nodeEnv = targetEnv.NODE_ENV ?? 'development';

  // Restrict local override loading strictly to development so test and production never read dev test keys.
  if (nodeEnv !== 'development') {
    return false;
  }

  const localEnvPath = path.resolve(options.cwd ?? process.cwd(), '.env.local');
  const exists = options.exists ?? fs.existsSync;
  if (!exists(localEnvPath)) {
    return false;
  }

  const readFile = options.readFile ?? ((filePath: string) => fs.readFileSync(filePath, 'utf8'));
  const parsed = dotenv.parse(readFile(localEnvPath));
  const preExistingKeys = options.preExistingKeys ?? new Set<string>();

  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'NODE_ENV' || preExistingKeys.has(key)) {
      continue;
    }

    targetEnv[key] = value;
  }

  return true;
}

const shellEnvKeys = new Set(Object.keys(process.env));
dotenv.config({ quiet: true });
applyLocalDevEnvOverrides({ preExistingKeys: shellEnvKeys });

const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1, 'must not be empty when provided').optional(),
);

const optionalEmail = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z
    .string()
    .trim()
    .regex(PATTERNS.EMAIL, 'must be a valid email address')
    .optional(),
);

const optionalHttpUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z
    .string()
    .trim()
    .refine(
      (val) => {
        try {
          const parsed = new URL(val);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'must be a valid http or https URL' },
    )
    .optional(),
);

function parseOriginsList(rawOrigins: string): string[] {
  return rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function isValidOrigin(origin: string): boolean {
  if (origin === '*') {
    return false;
  }

  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.origin === origin
    );
  } catch {
    return false;
  }
}

const allowedOriginsSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z
    .string()
    .default('http://localhost:5173')
    .transform((raw) => parseOriginsList(raw))
    .refine((origins) => origins.length > 0, {
      message: 'must include at least one allowed origin',
    })
    .refine((origins) => origins.every(isValidOrigin), {
      message:
        'must contain valid http(s) origins without wildcards or paths',
    }),
);

const databaseEnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'], {
      error: 'must be one of development, test, production',
    })
    .default('development'),
  DB_NAME: z
    .string({ error: 'is required' })
    .trim()
    .min(1, 'is required')
    .regex(PATTERNS.DATABASE_NAME, 'must be a valid MongoDB database name'),
  MONGODB_URI: z
    .string({ error: 'is required' })
    .trim()
    .min(1, 'is required')
    .regex(PATTERNS.MONGO_URI, 'must use mongodb:// or mongodb+srv://'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'], {
      error: 'must be a valid log level',
    })
    .optional(),
});

const environmentSchema = databaseEnvironmentSchema.extend({
  PORT: z.coerce
    .number({ error: 'must be a valid port number' })
    .int('must be an integer')
    .min(1, 'must be between 1 and 65535')
    .max(65535, 'must be between 1 and 65535')
    .default(5000),
  ALLOWED_ORIGINS: allowedOriginsSchema,
  ACTOR_HMAC_SECRET: optionalNonEmptyString,
  IP_HMAC_SECRET: optionalNonEmptyString,
  SESSION_SECRET: optionalNonEmptyString,
  TOTP_ENC_KEY: optionalNonEmptyString,
  ADMIN_BOOTSTRAP_EMAIL: optionalEmail,
  UPSTASH_REDIS_REST_URL: optionalHttpUrl,
  UPSTASH_REDIS_REST_TOKEN: optionalNonEmptyString,
  TURNSTILE_SECRET: optionalNonEmptyString,
  TURNSTILE_SITE_KEY: optionalNonEmptyString,
  VITE_TURNSTILE_SITE_KEY: optionalNonEmptyString,
  BARIKOI_API_KEY: optionalNonEmptyString,
  SENTRY_DSN: optionalHttpUrl,
});

export type DatabaseEnvironment = {
  nodeEnv: 'development' | 'test' | 'production';
  dbName: string;
  mongoUri: string;
  logLevel: LogLevel;
};

export type Environment = DatabaseEnvironment & {
  port: number;
  allowedOrigins: string[];
};

const CLOUDFLARE_TEST_TURNSTILE_PREFIX_RE = /^[123]x0{20}/i;
const PRODUCTION_MIN_SECRET_BYTES = 32;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isCloudflareTestTurnstileKey(value: string): boolean {
  return CLOUDFLARE_TEST_TURNSTILE_PREFIX_RE.test(value.trim());
}

function isProductionSafeOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === 'https:' &&
      !LOCAL_HOSTNAMES.has(parsed.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function assertProductionEnvironment(
  data: z.infer<typeof environmentSchema>,
  values: NodeJS.ProcessEnv,
): void {
  const issues: string[] = [];

  const rawAllowedOrigins = values.ALLOWED_ORIGINS;
  if (typeof rawAllowedOrigins !== 'string' || rawAllowedOrigins.trim().length === 0) {
    issues.push('ALLOWED_ORIGINS is required in production');
  } else if (!data.ALLOWED_ORIGINS.every(isProductionSafeOrigin)) {
    issues.push('ALLOWED_ORIGINS must contain only non-local https:// origins in production');
  }

  for (const [key, value] of [
    ['ACTOR_HMAC_SECRET', data.ACTOR_HMAC_SECRET],
    ['IP_HMAC_SECRET', data.IP_HMAC_SECRET],
    ['SESSION_SECRET', data.SESSION_SECRET],
  ] as const) {
    if (!value) {
      issues.push(`${key} is required in production`);
    } else if (Buffer.byteLength(value, 'utf8') < PRODUCTION_MIN_SECRET_BYTES) {
      issues.push(`${key} must be at least ${PRODUCTION_MIN_SECRET_BYTES} bytes in production`);
    }
  }

  if (
    data.ACTOR_HMAC_SECRET &&
    data.IP_HMAC_SECRET &&
    data.ACTOR_HMAC_SECRET === data.IP_HMAC_SECRET
  ) {
    issues.push('IP_HMAC_SECRET must differ from ACTOR_HMAC_SECRET in production');
  }

  if (!data.TOTP_ENC_KEY) {
    issues.push('TOTP_ENC_KEY is required in production');
  } else if (!isValidTotpKeyMaterial(data.TOTP_ENC_KEY)) {
    issues.push(
      'TOTP_ENC_KEY must be a 64-char hex key, 32-byte base64 key, or >= 32-byte secret in production',
    );
  }

  if (!data.UPSTASH_REDIS_REST_URL) {
    issues.push('UPSTASH_REDIS_REST_URL is required in production');
  } else if (new URL(data.UPSTASH_REDIS_REST_URL).protocol !== 'https:') {
    issues.push('UPSTASH_REDIS_REST_URL must use https:// in production');
  }

  if (!data.UPSTASH_REDIS_REST_TOKEN) {
    issues.push('UPSTASH_REDIS_REST_TOKEN is required in production');
  }

  if (!data.TURNSTILE_SECRET) {
    issues.push('TURNSTILE_SECRET is required in production');
  } else if (isCloudflareTestTurnstileKey(data.TURNSTILE_SECRET)) {
    issues.push('TURNSTILE_SECRET must not use Cloudflare dummy testing keys in production');
  }

  const configuredSiteKey = data.TURNSTILE_SITE_KEY ?? data.VITE_TURNSTILE_SITE_KEY;
  if (!configuredSiteKey) {
    issues.push('TURNSTILE_SITE_KEY or VITE_TURNSTILE_SITE_KEY is required in production');
  } else if (
    (data.TURNSTILE_SITE_KEY && isCloudflareTestTurnstileKey(data.TURNSTILE_SITE_KEY)) ||
    (data.VITE_TURNSTILE_SITE_KEY &&
      isCloudflareTestTurnstileKey(data.VITE_TURNSTILE_SITE_KEY))
  ) {
    issues.push(
      'TURNSTILE_SITE_KEY must not use Cloudflare dummy testing keys in production',
    );
  }

  if (issues.length > 0) {
    throw new Error(`Invalid environment configuration: ${issues.join('; ')}`);
  }
}

export function parseDatabaseEnvironment(
  values: NodeJS.ProcessEnv = process.env,
): DatabaseEnvironment {
  const result = databaseEnvironmentSchema.safeParse(values);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'} ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  const nodeEnv = result.data.NODE_ENV;
  const logLevel: LogLevel =
    result.data.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info');

  return {
    nodeEnv,
    dbName: result.data.DB_NAME,
    mongoUri: result.data.MONGODB_URI,
    logLevel,
  };
}

export function getDatabaseEnvironment(): DatabaseEnvironment {
  return parseDatabaseEnvironment();
}

export function parseEnvironment(
  values: NodeJS.ProcessEnv = process.env,
): Environment {
  const result = environmentSchema.safeParse(values);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'} ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  if (result.data.NODE_ENV === 'production') {
    assertProductionEnvironment(result.data, values);
  }

  const nodeEnv = result.data.NODE_ENV;
  const logLevel: LogLevel =
    result.data.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info');

  return {
    nodeEnv,
    port: result.data.PORT,
    dbName: result.data.DB_NAME,
    mongoUri: result.data.MONGODB_URI,
    allowedOrigins: result.data.ALLOWED_ORIGINS,
    logLevel,
  };
}

export function parseAllowedOrigins(rawValue: string | undefined): string[] {
  const result = allowedOriginsSchema.safeParse(rawValue);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => issue.message)
      .join('; ');
    throw new Error(`Invalid environment configuration: ALLOWED_ORIGINS ${issues}`);
  }

  return result.data;
}

export function getEnvironment(): Environment {
  return parseEnvironment();
}

export function getOptionalEnvValue(
  key:
    | 'ACTOR_HMAC_SECRET'
    | 'IP_HMAC_SECRET'
    | 'SESSION_SECRET'
    | 'TOTP_ENC_KEY'
    | 'ADMIN_BOOTSTRAP_EMAIL'
    | 'UPSTASH_REDIS_REST_URL'
    | 'UPSTASH_REDIS_REST_TOKEN'
    | 'TURNSTILE_SECRET'
    | 'TURNSTILE_SITE_KEY'
    | 'VITE_TURNSTILE_SITE_KEY'
    | 'BARIKOI_API_KEY'
    | 'SENTRY_DSN',
  values: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = values[key];
  if (typeof raw !== 'string') {
    return undefined;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getRequiredEnvSecret(
  key:
    | 'ACTOR_HMAC_SECRET'
    | 'IP_HMAC_SECRET'
    | 'SESSION_SECRET'
    | 'TOTP_ENC_KEY'
    | 'TURNSTILE_SECRET'
    | 'ADMIN_BOOTSTRAP_EMAIL',
  values: NodeJS.ProcessEnv = process.env,
): string {
  const value = getOptionalEnvValue(key, values);
  if (!value) {
    throw new Error(`Invalid environment configuration: ${key} is required`);
  }

  return value;
}
