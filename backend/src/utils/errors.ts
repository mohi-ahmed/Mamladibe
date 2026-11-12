import { ERROR_CODES } from '../constants/index.js';
import type { ApiErrorEnvelope, ErrorCode } from '../types/index.js';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;
  public readonly isOperational = true;

  constructor(
    code: ErrorCode,
    statusCode: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toEnvelope(): ApiErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export function validationError(
  message = 'Validation failed.',
  details?: Record<string, unknown>,
): AppError {
  return new AppError(ERROR_CODES.VALIDATION_ERROR, 400, message, details);
}

export function unauthorizedError(
  message = 'Authentication required.',
  details?: Record<string, unknown>,
): AppError {
  return new AppError(ERROR_CODES.UNAUTHORIZED, 401, message, details);
}

export function forbiddenError(
  message = 'You do not have access to this resource.',
  details?: Record<string, unknown>,
): AppError {
  return new AppError(ERROR_CODES.FORBIDDEN, 403, message, details);
}

export function notFoundError(
  message = 'Requested resource was not found.',
  details?: Record<string, unknown>,
): AppError {
  return new AppError(ERROR_CODES.NOT_FOUND, 404, message, details);
}

export function duplicateActionError(
  message = 'This action has already been recorded.',
  details?: Record<string, unknown>,
): AppError {
  return new AppError(ERROR_CODES.DUPLICATE_ACTION, 409, message, details);
}

export function lockedError(
  message = 'Too many failed attempts. Try again later.',
  details?: Record<string, unknown>,
): AppError {
  return new AppError(ERROR_CODES.LOCKED, 423, message, details);
}

export function editWindowClosedError(
  message = 'The quick-edit window has closed.',
): AppError {
  return new AppError(ERROR_CODES.EDIT_WINDOW_CLOSED, 403, message);
}

export function editLimitReachedError(
  message = 'The maximum number of edits has been reached.',
): AppError {
  return new AppError(ERROR_CODES.EDIT_LIMIT_REACHED, 403, message);
}

export function captchaRequiredError(
  message = 'CAPTCHA verification is required.',
): AppError {
  return new AppError(ERROR_CODES.CAPTCHA_REQUIRED, 428, message);
}

export function quotaExceededError(
  message = 'Daily comment limit reached.',
  details?: Record<string, unknown>,
): AppError {
  return new AppError(ERROR_CODES.QUOTA_EXCEEDED, 429, message, details);
}

export function rateLimitedError(
  message = 'Too many requests. Please try again later.',
  details?: Record<string, unknown>,
): AppError {
  return new AppError(ERROR_CODES.RATE_LIMITED, 429, message, details);
}

export function internalError(
  message = 'Something went wrong. Please try again.',
  statusCode = 500,
): AppError {
  return new AppError(ERROR_CODES.INTERNAL, statusCode, message);
}

