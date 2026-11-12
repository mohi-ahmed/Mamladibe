import { Router } from 'express';
import {
  handleGetMeta,
  handleGetMyQuota,
} from '../controllers/public.controller.js';
import { actorMiddleware } from '../middleware/actor.middleware.js';
import commentsRouter from './comments.routes.js';
import geoRouter from './geo.routes.js';
import incidentsRouter from './incidents.routes.js';
import trackRouter from './track.routes.js';

const publicRouter = Router();

publicRouter.get('/meta', handleGetMeta);
publicRouter.get('/me/quota', actorMiddleware, handleGetMyQuota);
publicRouter.use('/geo', geoRouter);
publicRouter.use('/incidents', incidentsRouter);
publicRouter.use('/comments', commentsRouter);
publicRouter.use('/track', trackRouter);

export default publicRouter;

