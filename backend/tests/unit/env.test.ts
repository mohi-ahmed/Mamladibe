import { describe, expect, it } from 'vitest';
import {
  applyLocalDevEnvOverrides,
  parseAllowedOrigins,
  parseEnvironment,
} from '../../src/config/env.js';

const validEnvironment = {
  MONGODB_URI: 'mongodb://localhost:27017',
  DB_NAME: 'mamladibe_test',
};

describe('parseEnvironment', () => {
  it('uses safe defaults for NODE_ENV, PORT, ALLOWED_ORIGINS, and LOG_LEVEL', () => {
    expect(parseEnvironment(validEnvironment)).toEqual({
      nodeEnv: 'development',
      port: 5000,
      dbName: 'mamladibe_test',
      mongoUri: validEnvironment.MONGODB_URI,
      allowedOrigins: ['http://localhost:5173'],
      logLevel: 'info',
    });
  });

  it('defaults LOG_LEVEL to silent in test environment', () => {
    expect(
      parseEnvironment({
        ...validEnvironment,
        NODE_ENV: 'test',
        PORT: '6000',
      }),
    ).toMatchObject({
      nodeEnv: 'test',
      port: 6000,
      logLevel: 'silent',
    });
  });

  it('parses multiple comma-separated ALLOWED_ORIGINS values', () => {
    const parsed = parseEnvironment({
      ...validEnvironment,
      ALLOWED_ORIGINS: 'https://mamladibe.org, http://localhost:5173',
    });

    expect(parsed.allowedOrigins).toEqual([
      'https://mamladibe.org',
      'http://localhost:5173',
    ]);
  });

  it('rejects wildcard and malformed ALLOWED_ORIGINS entries', () => {
    expect(() => parseAllowedOrigins('*')).toThrow(/ALLOWED_ORIGINS/);
    expect(() => parseAllowedOrigins('https://example.com/path')).toThrow(
      /ALLOWED_ORIGINS/,
    );
    expect(() => parseAllowedOrigins('not-a-url')).toThrow(/ALLOWED_ORIGINS/);
  });

  it('rejects a missing MongoDB URI without exposing its value', () => {
    expect(() => parseEnvironment({ DB_NAME: 'mamladibe_test' })).toThrow(
      /MONGODB_URI/,
    );
  });

  it('does not include a provided connection string or optional secret in validation errors', () => {
    const connectionString = 'mongodb-secret-value';
    const invalidEmail = 'not-an-email-secret-value';
    let thrownUriError: unknown;
    let thrownEmailError: unknown;

    try {
      parseEnvironment({
        ...validEnvironment,
        MONGODB_URI: connectionString,
      });
    } catch (error) {
      thrownUriError = error;
    }

    try {
      parseEnvironment({
        ...validEnvironment,
        ADMIN_BOOTSTRAP_EMAIL: invalidEmail,
      });
    } catch (error) {
      thrownEmailError = error;
    }

    expect(thrownUriError).toBeInstanceOf(Error);
    if (thrownUriError instanceof Error) {
      expect(thrownUriError.message).toMatch(/MONGODB_URI/);
      expect(thrownUriError.message).not.toContain(connectionString);
    }

    expect(thrownEmailError).toBeInstanceOf(Error);
    if (thrownEmailError instanceof Error) {
      expect(thrownEmailError.message).toMatch(/ADMIN_BOOTSTRAP_EMAIL/);
      expect(thrownEmailError.message).not.toContain(invalidEmail);
    }
  });

  it('rejects an invalid MongoDB URI scheme', () => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        MONGODB_URI: 'https://not-a-mongodb-uri',
      }),
    ).toThrow(/MONGODB_URI/);
  });

  it('rejects invalid database names', () => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        DB_NAME: 'production/db',
      }),
    ).toThrow(/DB_NAME/);
  });

  it('rejects invalid ports', () => {
    expect(() =>
      parseEnvironment({ ...validEnvironment, PORT: '70000' }),
    ).toThrow(/PORT/);
  });

  it('ignores empty optional secret placeholders from .env files', () => {
    expect(
      parseEnvironment({
        ...validEnvironment,
        ACTOR_HMAC_SECRET: '',
        ADMIN_BOOTSTRAP_EMAIL: '',
        UPSTASH_REDIS_REST_URL: '',
        SENTRY_DSN: '',
      }),
    ).toMatchObject({
      dbName: 'mamladibe_test',
    });
  });
});

describe('applyLocalDevEnvOverrides', () => {
  const localEnvContents = [
    'DB_NAME=mamladibe_dev',
    'TURNSTILE_SITE_KEY=dev_site_key',
    'TURNSTILE_SECRET=dev_secret_key',
    'NODE_ENV=production',
  ].join('\n');

  it('loads .env.local overrides in development while preserving shell env vars and NODE_ENV', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'development',
      DB_NAME: 'mamladibe',
      TURNSTILE_SECRET: 'real_prod_secret',
    };

    const applied = applyLocalDevEnvOverrides({
      env,
      preExistingKeys: new Set(['TURNSTILE_SITE_KEY']),
      exists: () => true,
      readFile: () => localEnvContents,
    });

    expect(applied).toBe(true);
    expect(env.DB_NAME).toBe('mamladibe_dev');
    expect(env.TURNSTILE_SECRET).toBe('dev_secret_key');
    expect(env.TURNSTILE_SITE_KEY).toBeUndefined();
    expect(env.NODE_ENV).toBe('development');
  });

  it('does not load .env.local in production or test environments', () => {
    for (const nodeEnv of ['production', 'test'] as const) {
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: nodeEnv,
        DB_NAME: 'mamladibe',
        TURNSTILE_SECRET: 'real_secret',
      };

      const applied = applyLocalDevEnvOverrides({
        env,
        exists: () => true,
        readFile: () => localEnvContents,
      });

      expect(applied).toBe(false);
      expect(env.DB_NAME).toBe('mamladibe');
      expect(env.TURNSTILE_SECRET).toBe('real_secret');
    }
  });

  it('returns false when .env.local does not exist', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'development',
      DB_NAME: 'mamladibe',
    };

    const applied = applyLocalDevEnvOverrides({
      env,
      exists: () => false,
      readFile: () => localEnvContents,
    });

    expect(applied).toBe(false);
    expect(env.DB_NAME).toBe('mamladibe');
  });
});

describe('parseEnvironment in production (fail-closed)', () => {
  const validProdEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    PORT: '5000',
    DB_NAME: 'mamladibe',
    MONGODB_URI: 'mongodb+srv://produser:prodpass@cluster0.example.mongodb.net/',
    ALLOWED_ORIGINS: 'https://mamladibe.org,https://www.mamladibe.org',
    ACTOR_HMAC_SECRET: 'a'.repeat(64),
    IP_HMAC_SECRET: 'b'.repeat(64),
    SESSION_SECRET: 'c'.repeat(64),
    TOTP_ENC_KEY: 'd'.repeat(64),
    UPSTASH_REDIS_REST_URL: 'https://prod-redis.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'upstash-prod-token-value',
    TURNSTILE_SECRET: '0x4AAAAAArealTurnstileSecretValue1234',
    TURNSTILE_SITE_KEY: '0x4AAAAAArealTurnstileSiteKeyValue',
  };

  it('accepts a complete, non-dummy HTTPS production configuration', () => {
    const parsed = parseEnvironment(validProdEnv);
    expect(parsed.nodeEnv).toBe('production');
    expect(parsed.dbName).toBe('mamladibe');
    expect(parsed.allowedOrigins).toEqual([
      'https://mamladibe.org',
      'https://www.mamladibe.org',
    ]);
  });

  it('fails closed when required secrets, origins, or Turnstile site key are missing without leaking values', () => {
    const partialEnv: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      DB_NAME: 'mamladibe',
      MONGODB_URI: validProdEnv.MONGODB_URI,
    };

    let thrown: unknown;
    try {
      parseEnvironment(partialEnv);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    if (thrown instanceof Error) {
      expect(thrown.message).toMatch(/ALLOWED_ORIGINS/);
      expect(thrown.message).toMatch(/ACTOR_HMAC_SECRET/);
      expect(thrown.message).toMatch(/IP_HMAC_SECRET/);
      expect(thrown.message).toMatch(/SESSION_SECRET/);
      expect(thrown.message).toMatch(/TOTP_ENC_KEY/);
      expect(thrown.message).toMatch(/UPSTASH_REDIS_REST_URL/);
      expect(thrown.message).toMatch(/UPSTASH_REDIS_REST_TOKEN/);
      expect(thrown.message).toMatch(/TURNSTILE_SECRET/);
      expect(thrown.message).toMatch(/TURNSTILE_SITE_KEY/);
      expect(thrown.message).not.toContain('prodpass');
    }
  });

  it('rejects Cloudflare dummy Turnstile credentials, insecure origins, and shared HMAC secrets in production', () => {
    expect(() =>
      parseEnvironment({
        ...validProdEnv,
        TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
      }),
    ).toThrow(/TURNSTILE_SECRET/);

    expect(() =>
      parseEnvironment({
        ...validProdEnv,
        TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
      }),
    ).toThrow(/TURNSTILE_SITE_KEY/);

    expect(() =>
      parseEnvironment({
        ...validProdEnv,
        ALLOWED_ORIGINS: 'http://localhost:5173',
      }),
    ).toThrow(/ALLOWED_ORIGINS/);

    expect(() =>
      parseEnvironment({
        ...validProdEnv,
        IP_HMAC_SECRET: validProdEnv.ACTOR_HMAC_SECRET,
      }),
    ).toThrow(/IP_HMAC_SECRET/);

    expect(() =>
      parseEnvironment({
        ...validProdEnv,
        TOTP_ENC_KEY: 'short-totp-secret',
      }),
    ).toThrow(/TOTP_ENC_KEY/);
  });
});
