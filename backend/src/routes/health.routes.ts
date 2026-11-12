import { Router } from 'express';
import { healthCheckController } from '../controllers/health.controller.js';

const healthRouter = Router();

healthRouter.get('/', healthCheckController);

export default healthRouter;

