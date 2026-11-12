import type { NextFunction, Request, Response } from 'express';
import { Error as MongooseError } from 'mongoose';
import { ZodError } from 'zod';
import { ERROR_CODES } from '../constants/index.js';
import { logger } from '../lib/logger.js';
import {
  AppError,
  duplicateActionError,
  internalError,
  validationError,
} from '../utils/errors.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function mapKnownError(error: unknown): AppError | null {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof ZodError) {
    return validationError('Validation failed.', {
      fields: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  if (
    error instanceof MongooseError.ValidationError ||
    error instanceof MongooseError.CastError
  ) {
    return validationError('Invalid request data.');
  }

  if (isRecord(error)) {
    const errorType = error.type;
    const status = error.status;
    const code = error.code;

    if (errorType === 'entity.too.large' || status === 413) {
      return new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        413,
        'Request payload exceeds the 20 KB size limit.',
      );
    }

    if (error instanceof SyntaxError && errorType === 'entity.parse.failed') {
      return validationError('Malformed JSON payload.');
    }

    if (code === 11000) {
      return duplicateActionError();
    }
  }

  return null;
}

export function errorHandlerMiddleware(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const mapped = mapKnownError(error);
  const requestLog = req.log ?? logger;

  if (mapped) {
    if (mapped.statusCode >= 500) {
      requestLog.error(
        {
          code: mapped.code,
          statusCode: mapped.statusCode,
          err: error,
        },
        'Operational server error',
      );
    } else {
      requestLog.warn(
        {
          code: mapped.code,
          statusCode: mapped.statusCode,
        },
        'Request rejected',
      );
    }

    if (
      mapped.code === ERROR_CODES.RATE_LIMITED &&
      typeof mapped.details?.retryAfterSeconds === 'number'
    ) {
      res.setHeader(
        'Retry-After',
        String(Math.max(1, Math.ceil(mapped.details.retryAfterSeconds))),
      );
    }

    res.status(mapped.statusCode).json(mapped.toEnvelope());
    return;
  }

  requestLog.error(
    {
      code: ERROR_CODES.INTERNAL,
      statusCode: 500,
      err: error,
    },
    'Unhandled internal error',
  );

  const fallback = internalError();
  res.status(fallback.statusCode).json(fallback.toEnvelope());
}

