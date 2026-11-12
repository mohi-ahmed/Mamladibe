import type { AddressInfo } from 'node:net';
import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';

async function withTestServer<T>(
  allowedOrigins: string[],
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const app = createApp({
    allowedOrigins,
    logger: createLogger({}, 'silent'),
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    return await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe('Express foundation and health endpoint', () => {
  const originalDbDescriptor = Object.getOwnPropertyDescriptor(
    mongoose.connection,
    'db',
  );

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalDbDescriptor) {
      Object.defineProperty(mongoose.connection, 'db', originalDbDescriptor);
    } else {
      Reflect.deleteProperty(mongoose.connection, 'db');
    }
  });

  it('returns 200 ok on GET /api/v1/health when database ping succeeds with security headers', async () => {
    const pingMock = vi.fn().mockResolvedValue({ ok: 1 });
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);
    Object.defineProperty(mongoose.connection, 'db', {
      configurable: true,
      writable: true,
      value: {
        admin: () => ({ ping: pingMock }),
      } as unknown as typeof mongoose.connection.db,
    });

    await withTestServer(['http://localhost:5173'], async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/health`, {
        headers: {
          Origin: 'http://localhost:5173',
          'X-Request-Id': 'test-req-123456',
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-request-id')).toBe('test-req-123456');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('permissions-policy')).toBe('geolocation=(self)');
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'http://localhost:5173',
      );

      const body = (await response.json()) as Record<string, unknown>;
      expect(body.status).toBe('ok');
      expect(body.database).toBe('connected');
      expect(typeof body.timestamp).toBe('string');
      expect(JSON.stringify(body)).not.toContain('mongodb');
    });
  });

  it('returns 503 unavailable on GET /api/v1/health when database ping fails without leaking secrets or stack traces', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);
    Object.defineProperty(mongoose.connection, 'db', {
      configurable: true,
      writable: true,
      value: {
        admin: () => ({
          ping: vi
            .fn()
            .mockRejectedValue(
              new Error('auth failed mongodb+srv://user:secret@cluster/mamladibe'),
            ),
        }),
      } as unknown as typeof mongoose.connection.db,
    });

    await withTestServer(['http://localhost:5173'], async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      expect(response.status).toBe(503);

      const rawText = await response.text();
      expect(rawText).not.toContain('secret');
      expect(rawText).not.toContain('mongodb');
      expect(rawText).not.toContain('at ');

      const body = JSON.parse(rawText) as Record<string, unknown>;
      expect(body.status).toBe('unavailable');
      expect(body.database).toBe('disconnected');
    });
  });

  it('does not reflect disallowed CORS origins', async () => {
    await withTestServer(['http://localhost:5173'], async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/health`, {
        headers: { Origin: 'https://evil.example.com' },
      });
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  it('returns 404 with standard error envelope for unknown routes', async () => {
    await withTestServer(['http://localhost:5173'], async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/nonexistent`);
      expect(response.status).toBe(404);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: 'Route not found.',
        },
      });
    });
  });

  it('enforces the 20 KB JSON body limit and returns standard error envelope', async () => {
    await withTestServer(['http://localhost:5173'], async (baseUrl) => {
      const oversizedPayload = JSON.stringify({ data: 'x'.repeat(25 * 1024) });
      const response = await fetch(`${baseUrl}/api/v1/unknown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: oversizedPayload,
      });

      expect(response.status).toBe(413);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request payload exceeds the 20 KB size limit.',
        },
      });
    });
  });

  it('rejects malformed JSON with 400 VALIDATION_ERROR', async () => {
    await withTestServer(['http://localhost:5173'], async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/unknown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"broken": ',
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Malformed JSON payload.',
        },
      });
    });
  });
});

