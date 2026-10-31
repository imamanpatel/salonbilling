import { createApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { startJobs } from './jobs/index.js';
import { logger } from './lib/logger.js';

const server = createApp().listen(config.port, () => {
  logger.info(`API listening on http://localhost:${config.port}`);
});
const jobs = startJobs({ logger });

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  jobs.stop();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
