import { Router } from 'express';
import {
  handleGeoReverse,
  handleGeoSearch,
} from '../controllers/public.controller.js';
import { validateQuery } from '../middleware/validate.middleware.js';
import {
  geoReverseQuerySchema,
  geoSearchQuerySchema,
} from '../validators/public.validator.js';

const geoRouter = Router();

geoRouter.get('/reverse', validateQuery(geoReverseQuerySchema), handleGeoReverse);
geoRouter.get('/search', validateQuery(geoSearchQuerySchema), handleGeoSearch);

export default geoRouter;

