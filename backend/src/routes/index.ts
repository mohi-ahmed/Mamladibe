import { Router } from 'express';
import { ensureDbConnectedMiddleware } from '../middleware/db-connect.middleware.js';
import { createOriginCheckMiddleware } from '../middleware/origin.middleware.js';
import adminRouter from './admin.routes.js';
import healthRouter from './health.routes.js';
import publicRouter from './public.routes.js';

export function createApiV1Router(allowedOrigins?: readonly string[]): Router {
  const apiV1Router = Router();

  apiV1Router.use(ensureDbConnectedMiddleware);
  apiV1Router.use(createOriginCheckMiddleware(allowedOrigins));
  apiV1Router.use('/health', healthRouter);
  apiV1Router.use('/admin', adminRouter);
  apiV1Router.use('/', publicRouter);

  return apiV1Router;
}

export default createApiV1Router();

