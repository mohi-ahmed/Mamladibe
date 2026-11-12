import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { createLogger, type StructuredLogger } from '../lib/logger.js';

const SAFE_REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;

export function createRequestIdMiddleware(baseLogger: StructuredLogger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incomingHeader = req.header('x-request-id');
    const requestId =
      typeof incomingHeader === 'string' &&
      SAFE_REQUEST_ID_PATTERN.test(incomingHeader)
        ? incomingHeader
        : crypto.randomUUID();

    req.requestId = requestId;
    req.log = baseLogger.child({ requestId });
    res.setHeader('X-Request-Id', requestId);
    next();
  };
}

export const requestIdMiddleware = createRequestIdMiddleware(createLogger());

