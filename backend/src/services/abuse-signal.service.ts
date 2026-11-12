import { ABUSE_SIGNAL_TYPES, PATTERNS } from '../constants/index.js';
import { createLogger } from '../lib/logger.js';
import { AbuseSignalModel } from '../models/index.js';
import { internalError } from '../utils/errors.js';

export type AbuseSignalType = (typeof ABUSE_SIGNAL_TYPES)[number];

const abuseLogger = createLogger({ module: 'abuse-signal' });

function assertValidIpHash(ipHash: string | undefined, context: string): string {
  if (!ipHash || !PATTERNS.IP_HASH_HEX.test(ipHash)) {
    throw internalError(
      `Valid IP hash is required for ${context}.`,
      500,
    );
  }
  return ipHash;
}

export async function recordAbuseSignal(input: {
  ipHash: string | undefined;
  actorId?: string;
  type: AbuseSignalType;
}): Promise<void> {
  const validIpHash = assertValidIpHash(input.ipHash, 'abuse signal recording');

  try {
    await AbuseSignalModel.create({
      ipHash: validIpHash,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      type: input.type,
    });
  } catch (error) {
    abuseLogger.warn(
      {
        type: input.type,
        errName: error instanceof Error ? error.name : 'UnknownError',
      },
      'Failed to persist abuse signal',
    );
  }
}

export async function isIpRiskElevated(
  ipHash: string | undefined,
  windowMinutes = 60,
  threshold = 3,
): Promise<boolean> {
  const validIpHash = assertValidIpHash(ipHash, 'IP risk lookup');

  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
  const count = await AbuseSignalModel.countDocuments({
    ipHash: validIpHash,
    createdAt: { $gte: cutoff },
  });

  return count >= threshold;
}

