import { createApp } from './app.js';
import { getEnvironment } from './config/env.js';
import { createLogger } from './lib/logger.js';

const env = getEnvironment();
const logger = createLogger({ service: 'mamladibe-backend' }, env.logLevel);

const app = createApp({
  allowedOrigins: env.allowedOrigins,
  logger,
});

export default app;

