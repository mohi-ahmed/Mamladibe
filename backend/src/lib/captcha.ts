import {
  getOptionalEnvValue,
  isCloudflareTestTurnstileKey,
} from '../config/env.js';
import { createLogger } from './logger.js';
import { captchaRequiredError, internalError } from '../utils/errors.js';

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_TIMEOUT_MS = 5000;

const captchaLogger = createLogger({ module: 'captcha' });

export type TurnstileVerifierFn = (input: {
  token: string;
  remoteIp?: string;
}) => Promise<boolean>;

let testVerifierOverride: TurnstileVerifierFn | null = null;

export function setTurnstileVerifierForTests(
  verifier: TurnstileVerifierFn | null,
): void {
  testVerifierOverride = verifier;
}

interface TurnstileSiteVerifyResponse {
  success?: boolean;
  'error-codes'?: string[];
}

export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp?: string,
): Promise<boolean> {
  if (!token || token.trim().length === 0) {
    throw captchaRequiredError('CAPTCHA verification is required.');
  }

  const normalizedToken = token.trim();

  if (testVerifierOverride) {
    const passed = await testVerifierOverride({
      token: normalizedToken,
      remoteIp,
    });
    if (!passed) {
      throw captchaRequiredError('CAPTCHA verification failed.');
    }
    return true;
  }

  const secret = getOptionalEnvValue('TURNSTILE_SECRET');
  if (!secret) {
    captchaLogger.error({}, 'TURNSTILE_SECRET is not configured');
    throw internalError(
      'CAPTCHA verification service is temporarily unavailable.',
      503,
    );
  }

  if (process.env.NODE_ENV === 'production' && isCloudflareTestTurnstileKey(secret)) {
    captchaLogger.error({}, 'Refusing Cloudflare test Turnstile secret in production');
    throw internalError(
      'CAPTCHA verification service is temporarily unavailable.',
      503,
    );
  }

  const form = new URLSearchParams({
    secret,
    response: normalizedToken,
  });

  if (remoteIp) {
    form.set('remoteip', remoteIp);
  }

  let response: Response;
  try {
    response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    });
  } catch (error) {
    captchaLogger.warn(
      { errName: error instanceof Error ? error.name : 'UnknownError' },
      'Turnstile verification request failed',
    );
    throw internalError(
      'Verification service is temporarily unavailable.',
      503,
    );
  }

  if (!response.ok) {
    captchaLogger.warn(
      { status: response.status },
      'Turnstile verification returned non-200 status',
    );
    throw internalError(
      'Verification service is temporarily unavailable.',
      503,
    );
  }

  const data = (await response.json()) as TurnstileSiteVerifyResponse;
  if (!data.success) {
    throw captchaRequiredError('CAPTCHA verification failed.');
  }

  return true;
}

