import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { connectToDatabase } from '../config/database.js';
import { getEnvironment } from '../config/env.js';

/**
 * Ensures Mongoose is connected on serverless cold starts before running DB-backed routes.
 * /api/v1/health handles connectivity checks itself and returns 503 safely if down.
 */
export async function ensureDbConnectedMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.path === '/health' || req.path === '/meta') {
    next();
    return;
  }

  if (mongoose.connection.readyState === 1) {
    next();
    return;
  }

  try {
    const env = getEnvironment();
    await connectToDatabase(env.dbName);
    next();
  } catch (error) {
    next(error);
  }
}

