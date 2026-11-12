import { Router } from 'express';
import { handleTrackIncident } from '../controllers/public.controller.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { trackBodySchema } from '../validators/public.validator.js';

const trackRouter = Router();

trackRouter.post('/', validateBody(trackBodySchema), handleTrackIncident);

export default trackRouter;

