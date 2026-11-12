import type { NextFunction, Request, Response } from 'express';

export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const elapsedNs = process.hrtime.bigint() - startedAt;
    const durationMs = Math.round((Number(elapsedNs) / 1_000_000) * 100) / 100;

    req.log.info(
      {
        method: req.method,
        path: req.baseUrl ? `${req.baseUrl}${req.path}` : req.path,
        statusCode: res.statusCode,
        durationMs,
      },
      'HTTP request completed',
    );
  });

  next();
}

