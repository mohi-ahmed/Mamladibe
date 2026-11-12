import type { Types } from 'mongoose';
import type { StructuredLogger } from '../lib/logger.js';
import type { AdminRole } from './models.types.js';

export interface AuthenticatedAdminContext {
  adminId: Types.ObjectId;
  sessionId: Types.ObjectId;
  email: string;
  role: AdminRole;
  csrfToken: string;
  stage: 'pending_2fa' | 'active';
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      log: StructuredLogger;
      actorId?: string;
      ipHash?: string;
      adminSession?: AuthenticatedAdminContext;
    }
  }
}

export {};

