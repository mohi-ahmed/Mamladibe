import type { Request, Response } from 'express';
import { getHealthStatus } from '../services/health.service.js';

export async function healthCheckController(
  req: Request,
  res: Response,
): Promise<void> {
  const result = await getHealthStatus();

  if (result.safeError) {
    req.log.error(
      { err: result.safeError },
      'Database health check failed',
    );
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(result.statusCode).json(result.body);
}

