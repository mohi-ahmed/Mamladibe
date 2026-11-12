import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/lib/logger.js';

describe('structured logger sensitive-data redaction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redacts sensitive keys and MongoDB connection URIs', () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });

    const log = createLogger({ requestId: 'req-1234' }, 'info');
    log.info(
      {
        mongoUri:
          'mongodb+srv://admin:atlas-secret-pw@cluster.mongodb.net/mamladibe',
        passwordHash: 'argon2-hash',
        secret: 'reporter-secret',
        nested: {
          note: 'Error connecting to mongodb://user:local-secret-pw@localhost:27017/db',
          token: 'raw-token',
        },
      },
      'Diagnostic check for mongodb://user:local-secret-pw@localhost:27017/db',
    );

    expect(chunks).toHaveLength(1);
    const parsed = JSON.parse(chunks[0]) as Record<string, unknown>;
    expect(parsed.requestId).toBe('req-1234');
    expect(parsed.mongoUri).toBe('[REDACTED]');
    expect(parsed.passwordHash).toBe('[REDACTED]');
    expect(parsed.secret).toBe('[REDACTED]');
    expect((parsed.nested as Record<string, unknown>).token).toBe('[REDACTED]');
    expect((parsed.nested as Record<string, unknown>).note).toContain(
      '[REDACTED_MONGODB_URI]',
    );
    expect(String(parsed.msg)).toContain('[REDACTED_MONGODB_URI]');
    expect(chunks[0]).not.toContain('atlas-secret-pw');
    expect(chunks[0]).not.toContain('local-secret-pw');
    expect(chunks[0]).not.toContain('argon2-hash');
    expect(chunks[0]).not.toContain('reporter-secret');
    expect(chunks[0]).not.toContain('raw-token');
  });
});

