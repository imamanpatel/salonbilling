import { sendMessage } from '../services/messageProviders.js';
import { messagingSettingsFor, providerFor } from '../services/messaging.js';

export const SENDER_BATCH = 50;
export const MAX_ATTEMPTS = 3;
const RETRY_STEP_MS = 5 * 60_000;
/** A picked message is pushed this far ahead while it is being sent, so another instance won't pick it too. */
const LEASE_MS = 2 * 60_000;

/**
 * Sends up to `batchSize` due QUEUED messages, oldest first, with each branch's provider.
 * Failures retry after attempts × 5 minutes and become FAILED after MAX_ATTEMPTS.
 */
export async function runSender(prisma, { now = new Date(), send = sendMessage, logger, batchSize = SENDER_BATCH } = {}) {
  const due = await prisma.messageLog.findMany({
    where: { status: 'QUEUED', scheduledFor: { lte: now } },
    orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }],
    take: batchSize,
  });
  const settingsByBranch = new Map();
  const result = { sent: 0, retrying: 0, failed: 0 };

  for (const log of due) {
    const claimed = await prisma.messageLog.updateMany({
      where: { id: log.id, status: 'QUEUED', scheduledFor: log.scheduledFor },
      data: { scheduledFor: new Date(now.getTime() + LEASE_MS) },
    });
    if (!claimed.count) continue;

    if (!settingsByBranch.has(log.branchId)) settingsByBranch.set(log.branchId, await messagingSettingsFor(prisma, log.branchId));
    const { provider, config } = providerFor(settingsByBranch.get(log.branchId), log.channel);

    let outcome;
    try {
      outcome = await send({ channel: log.channel, provider, config, to: log.recipient, body: log.body, kind: log.kind, logger });
    } catch (err) {
      outcome = { ok: false, error: err?.message ?? String(err) };
    }

    const attempts = log.attempts + 1;
    if (outcome.ok) {
      await prisma.messageLog.update({
        where: { id: log.id },
        data: { status: 'SENT', provider, providerRef: outcome.providerRef ?? null, sentAt: now, attempts, error: null },
      });
      result.sent += 1;
    } else if (attempts >= MAX_ATTEMPTS) {
      await prisma.messageLog.update({ where: { id: log.id }, data: { status: 'FAILED', provider, attempts, error: outcome.error ?? 'Failed' } });
      result.failed += 1;
    } else {
      await prisma.messageLog.update({
        where: { id: log.id },
        data: { provider, attempts, error: outcome.error ?? 'Failed', scheduledFor: new Date(now.getTime() + attempts * RETRY_STEP_MS) },
      });
      result.retrying += 1;
    }
  }
  return result;
}
