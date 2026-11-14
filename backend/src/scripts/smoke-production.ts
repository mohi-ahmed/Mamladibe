import { Redis } from '@upstash/redis';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the production smoke test.`);
  return value;
}

function productionBaseUrl(): string {
  const raw = required('SMOKE_BASE_URL');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SMOKE_BASE_URL must be an HTTPS origin without a path.');
  }
  return url.origin;
}

async function expectJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !payload) {
    throw new Error(`Smoke request failed (${response.status}) for ${new URL(url).pathname}.`);
  }
  return payload;
}

async function checkHttpAndMongo(baseUrl: string): Promise<void> {
  const health = await expectJson(`${baseUrl}/api/v1/health`);
  if (health.status !== 'ok' || health.database !== 'connected') {
    throw new Error('Health endpoint did not confirm a connected MongoDB database.');
  }
  process.stdout.write('PASS same-origin proxy and MongoDB health\n');
}

async function checkPublicMeta(baseUrl: string): Promise<void> {
  const meta = await expectJson(`${baseUrl}/api/v1/meta`);
  if (typeof meta.turnstileSiteKey !== 'string' || meta.turnstileSiteKey.length === 0) {
    throw new Error('Public meta endpoint did not return a Turnstile site key.');
  }
  process.stdout.write('PASS public meta and Turnstile site-key exposure\n');
}

async function checkRedis(): Promise<void> {
  const redis = new Redis({
    url: required('UPSTASH_REDIS_REST_URL'),
    token: required('UPSTASH_REDIS_REST_TOKEN'),
  });
  const result = await redis.ping();
  if (result !== 'PONG') throw new Error('Upstash Redis did not return PONG.');
  process.stdout.write('PASS Upstash Redis connectivity\n');
}

async function checkTurnstileSecret(): Promise<void> {
  const body = new URLSearchParams({
    secret: required('TURNSTILE_SECRET'),
    response: 'mamladibe-production-smoke-invalid-token',
  });
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json()) as {
    success?: boolean;
    'error-codes'?: string[];
  };
  const errors = payload['error-codes'] ?? [];
  if (!response.ok || errors.includes('missing-input-secret') || errors.includes('invalid-input-secret')) {
    throw new Error('Cloudflare rejected the configured Turnstile secret.');
  }
  if (payload.success !== false) {
    throw new Error('Turnstile unexpectedly accepted the intentionally invalid smoke token.');
  }
  process.stdout.write('PASS Turnstile secret and siteverify connectivity\n');
}

async function main(): Promise<void> {
  const baseUrl = productionBaseUrl();
  await checkHttpAndMongo(baseUrl);
  await checkPublicMeta(baseUrl);
  await checkRedis();
  await checkTurnstileSecret();
  process.stdout.write('Production smoke test completed successfully.\n');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown smoke-test failure.';
  process.stderr.write(`FAIL ${message}\n`);
  process.exitCode = 1;
});
