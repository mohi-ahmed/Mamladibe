import { Router } from 'express';
import {
  handleDeleteOwnComment,
  handleReportComment,
} from '../controllers/public.controller.js';
import { actorMiddleware } from '../middleware/actor.middleware.js';
import { validateBody, validateParams } from '../middleware/validate.middleware.js';
import {
  commentIdParamSchema,
  reportBodySchema,
} from '../validators/public.validator.js';

const commentsRouter = Router();

commentsRouter.delete(
  '/:id',
  actorMiddleware,
  validateParams(commentIdParamSchema),
  handleDeleteOwnComment,
);

commentsRouter.post(
  '/:id/reports',
  actorMiddleware,
  validateParams(commentIdParamSchema),
  validateBody(reportBodySchema),
  handleReportComment,
);

export default commentsRouter;

