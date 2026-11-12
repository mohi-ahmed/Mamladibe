import type { NextFunction, Request, Response } from 'express';
import { parseAllowedOrigins } from '../config/env.js';
import { forbiddenError } from '../utils/errors.js';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createOriginCheckMiddleware(
  allowedOrigins?: readonly string[],
) {
  const allowSet = new Set(
    allowedOrigins ?? parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
  );

  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!STATE_CHANGING_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    const origin = req.header('origin');
    if (!origin || !allowSet.has(origin)) {
      next(forbiddenError('Request origin is not permitted.'));
      return;
    }

    next();
  };
}

