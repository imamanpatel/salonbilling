import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { logger } from './lib/logger.js';
import { requireAuth } from './middleware/auth.js';
import { requireBranch } from './middleware/branch.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import branchRoutes from './routes/branches.js';
import categoryRoutes from './routes/categories.js';
import serviceRoutes from './routes/services.js';
import settingsRoutes from './routes/settings.js';
import staffRoutes from './routes/staff.js';
import userRoutes from './routes/users.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // Organisation-level routes
  app.use('/api/auth', authRoutes);
  app.use('/api/branches', requireAuth, branchRoutes);
  app.use('/api/users', requireAuth, userRoutes);

  // Branch-scoped routes (x-branch-id header)
  app.use('/api/staff', requireAuth, requireBranch, staffRoutes);
  app.use('/api/service-categories', requireAuth, requireBranch, categoryRoutes);
  app.use('/api/services', requireAuth, requireBranch, serviceRoutes);
  app.use('/api/settings', requireAuth, requireBranch, settingsRoutes);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
