import { prisma } from '../db.js';
import { runDailyJobs } from './daily.js';
import { runSender } from './sender.js';

export { runDailyJobs } from './daily.js';
export { runSender } from './sender.js';

const SENDER_EVERY_MS = 15_000;
const DAILY_EVERY_MS = 10 * 60_000;
const FIRST_DAILY_AFTER_MS = 5_000;

/** Runs `task` unless its previous run is still going; errors are logged, never thrown. */
function guarded(name, task, logger) {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch (err) {
      logger?.error({ err, job: name }, 'Background job failed');
    } finally {
      running = false;
    }
  };
}

/**
 * Starts background jobs (message sending, daily reminders). Called once by server.js; not used by tests,
 * which call runSender / runDailyJobs directly with a fixed `now`.
 */
export function startJobs({ logger, db = prisma } = {}) {
  const sender = guarded('message-sender', () => runSender(db, { logger }), logger);
  const daily = guarded(
    'daily-reminders',
    async () => {
      const summary = await runDailyJobs(db, { logger });
      if (summary.ran.length) logger?.info({ date: summary.date, ran: summary.ran }, 'Daily messaging jobs ran');
    },
    logger,
  );

  const timers = [
    setInterval(sender, SENDER_EVERY_MS),
    setInterval(daily, DAILY_EVERY_MS),
    setTimeout(daily, FIRST_DAILY_AFTER_MS),
  ];
  timers.forEach((timer) => timer.unref?.());

  return {
    stop() {
      timers.forEach((timer) => clearTimeout(timer));
    },
  };
}
