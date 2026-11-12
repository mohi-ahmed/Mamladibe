import { Router } from 'express';
import {
  handleCreateComment,
  handleCreateIncident,
  handleGetIncident,
  handleListComments,
  handleListIncidents,
  handleQuickEditIncident,
  handleRemoveVote,
  handleReportIncident,
  handleVoteIncident,
} from '../controllers/public.controller.js';
import { actorMiddleware } from '../middleware/actor.middleware.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validate.middleware.js';
import {
  createCommentBodySchema,
  createIncidentBodySchema,
  listCommentsQuerySchema,
  listIncidentsQuerySchema,
  quickEditBodySchema,
  reportBodySchema,
  trackingIdParamSchema,
  voteBodySchema,
} from '../validators/public.validator.js';

const incidentsRouter = Router();

incidentsRouter.get(
  '/',
  validateQuery(listIncidentsQuerySchema),
  handleListIncidents,
);

incidentsRouter.post(
  '/',
  actorMiddleware,
  validateBody(createIncidentBodySchema),
  handleCreateIncident,
);

incidentsRouter.get(
  '/:trackingId',
  validateParams(trackingIdParamSchema),
  handleGetIncident,
);

incidentsRouter.patch(
  '/:trackingId',
  validateParams(trackingIdParamSchema),
  validateBody(quickEditBodySchema),
  handleQuickEditIncident,
);

incidentsRouter.post(
  '/:trackingId/vote',
  actorMiddleware,
  validateParams(trackingIdParamSchema),
  validateBody(voteBodySchema),
  handleVoteIncident,
);

incidentsRouter.delete(
  '/:trackingId/vote',
  actorMiddleware,
  validateParams(trackingIdParamSchema),
  handleRemoveVote,
);

incidentsRouter.post(
  '/:trackingId/reports',
  actorMiddleware,
  validateParams(trackingIdParamSchema),
  validateBody(reportBodySchema),
  handleReportIncident,
);

incidentsRouter.get(
  '/:trackingId/comments',
  validateParams(trackingIdParamSchema),
  validateQuery(listCommentsQuerySchema),
  handleListComments,
);

incidentsRouter.post(
  '/:trackingId/comments',
  actorMiddleware,
  validateParams(trackingIdParamSchema),
  validateBody(createCommentBodySchema),
  handleCreateComment,
);

export default incidentsRouter;

