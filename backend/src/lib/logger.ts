import { redactMongoUris } from '../utils/text.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 100,
};

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /cookie/i,
  /authorization/i,
  /mongo(?:db)?_?uri/i,
  /sessionhash/i,
  /totp/i,
  /rawip/i,
  /clientip/i,
  /remoteip/i,
  /^ip$/i,
  /dsn/i,
  /api_?key/i,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return '[TRUNCATED]';
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return redactMongoUris(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    const code: unknown = Reflect.get(value, 'code');
    return {
      name: value.name,
      ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSensitiveKey(k)) {
        output[k] = '[REDACTED]';
      } else {
        output[k] = sanitizeLogValue(v, depth + 1);
      }
    }
    return output;
  }

  return String(value);
}

export interface StructuredLogger {
  trace(objOrMsg: Record<string, unknown> | string, msg?: string): void;
  debug(objOrMsg: Record<string, unknown> | string, msg?: string): void;
  info(objOrMsg: Record<string, unknown> | string, msg?: string): void;
  warn(objOrMsg: Record<string, unknown> | string, msg?: string): void;
  error(objOrMsg: Record<string, unknown> | string, msg?: string): void;
  fatal(objOrMsg: Record<string, unknown> | string, msg?: string): void;
  child(bindings: Record<string, unknown>): StructuredLogger;
}

function resolveDefaultLogLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL;
  if (
    configured === 'trace' ||
    configured === 'debug' ||
    configured === 'info' ||
    configured === 'warn' ||
    configured === 'error' ||
    configured === 'fatal' ||
    configured === 'silent'
  ) {
    return configured;
  }

  return process.env.NODE_ENV === 'test' ? 'silent' : 'info';
}

/**
 * Pino-compatible structured JSON logger using Node built-in streams.
 * Note: `pino` is specified in the PRD tech stack and can replace this thin
 * implementation once added to package.json.
 */
export function createLogger(
  bindings: Record<string, unknown> = {},
  level: LogLevel = resolveDefaultLogLevel(),
): StructuredLogger {
  const minPriority = LEVEL_PRIORITY[level];
  const sanitizedBindings = sanitizeLogValue(bindings) as Record<string, unknown>;

  function write(
    entryLevel: Exclude<LogLevel, 'silent'>,
    objOrMsg: Record<string, unknown> | string,
    msg?: string,
  ): void {
    if (LEVEL_PRIORITY[entryLevel] < minPriority) {
      return;
    }

    const payload: Record<string, unknown> = {
      level: LEVEL_PRIORITY[entryLevel],
      levelName: entryLevel,
      time: new Date().toISOString(),
      ...sanitizedBindings,
    };

    if (typeof objOrMsg === 'string') {
      payload.msg = redactMongoUris(objOrMsg);
    } else {
      const sanitizedObj = sanitizeLogValue(objOrMsg) as Record<string, unknown>;
      Object.assign(payload, sanitizedObj);
      if (msg !== undefined) {
        payload.msg = redactMongoUris(msg);
      }
    }

    const line = `${JSON.stringify(payload)}\n`;
    if (LEVEL_PRIORITY[entryLevel] >= LEVEL_PRIORITY.error) {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  }

  return {
    trace: (objOrMsg, msg) => write('trace', objOrMsg, msg),
    debug: (objOrMsg, msg) => write('debug', objOrMsg, msg),
    info: (objOrMsg, msg) => write('info', objOrMsg, msg),
    warn: (objOrMsg, msg) => write('warn', objOrMsg, msg),
    error: (objOrMsg, msg) => write('error', objOrMsg, msg),
    fatal: (objOrMsg, msg) => write('fatal', objOrMsg, msg),
    child: (childBindings) =>
      createLogger({ ...sanitizedBindings, ...childBindings }, level),
  };
}

export const logger = createLogger();

