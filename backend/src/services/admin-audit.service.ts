import type { Types } from 'mongoose';
import { AuditLogModel } from '../models/index.js';

export interface AuditLogInput {
  adminId: Types.ObjectId;
  action: string;
  targetType?: string;
  targetId?: Types.ObjectId;
  reason?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  createdAt?: Date;
}

export async function writeAuditLog(entry: AuditLogInput): Promise<void> {
  await AuditLogModel.create({
    adminId: entry.adminId,
    action: entry.action,
    ...(entry.targetType ? { targetType: entry.targetType } : {}),
    ...(entry.targetId ? { targetId: entry.targetId } : {}),
    ...(entry.reason ? { reason: entry.reason } : {}),
    ...(entry.before ? { before: entry.before } : {}),
    ...(entry.after ? { after: entry.after } : {}),
    createdAt: entry.createdAt ?? new Date(),
  });
}

