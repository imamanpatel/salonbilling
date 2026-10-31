import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { requireAuth } from './middleware/auth.js';
import { requireBranch } from './middleware/branch.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import branchRoutes from './routes/branches.js';
import categoryRoutes from './routes/categories.js';
import clientRoutes from './routes/clients.js';
import enquiryRoutes from './routes/enquiries.js';
import followUpRoutes from './routes/followUps.js';
import serviceRoutes from './routes/services.js';
import settingsRoutes from './routes/settings.js';
import staffRoutes from './routes/staff.js';
import teamRoutes from './routes/team.js';
import userRoutes from './routes/users.js';

// Feature modules: every file in routes/modules exports `mount = { path, scope }` and a default Router.
// scope: 'public' (no sign-in), 'org' (signed in) or 'branch' (signed in + x-branch-id header).
const MODULES_DIR = new URL('./routes/modules/', import.meta.url);
const SCOPE_GUARDS = { public: [], org: [requireAuth], branch: [requireAuth, requireBranch] };
const moduleRoutes = await loadModuleRoutes();

async function loadModuleRoutes() {
  const dir = fileURLToPath(MODULES_DIR);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.js')).sort();
  return Promise.all(
    files.map(async (file) => {
      const mod = await import(new URL(file, MODULES_DIR).href);
      const scope = mod.mount?.scope ?? 'branch';
      if (!mod.mount?.path || !mod.default || !SCOPE_GUARDS[scope]) {
        throw new Error(`routes/modules/${file} must export mount = { path, scope: 'public' | 'org' | 'branch' } and a default router`);
      }
      return { path: mod.mount.path, scope, router: mod.default };
    }),
  );
}

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
  app.use('/api/team', requireAuth, requireBranch, teamRoutes);
  app.use('/api/clients', requireAuth, requireBranch, clientRoutes);
  app.use('/api/enquiries', requireAuth, requireBranch, enquiryRoutes);
  app.use('/api/follow-ups', requireAuth, requireBranch, followUpRoutes);

  for (const { path, scope, router } of moduleRoutes) {
    app.use(`/api${path}`, ...SCOPE_GUARDS[scope], router);
  }

  // Uploaded images (offers, gallery). Cross-origin so a salon's own website can embed them.
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  app.use(
    '/uploads',
    express.static(config.uploadsDir, {
      maxAge: '7d',
      fallthrough: false,
      setHeaders: (res) => res.set('Cross-Origin-Resource-Policy', 'cross-origin'),
    }),
  );

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
