import { CHANNEL_FIELDS, clientVars, renderTemplate } from '@salon/shared/messaging';

// Outgoing messages are only *queued* here (a MessageLog row); the jobs in src/jobs send them in the background,
// so billing and booking never wait on an SMS/WhatsApp provider.

export { renderTemplate };

export const DEFAULT_TEMPLATES = {
  BIRTHDAY: 'Happy birthday {firstName}! Wishing you a wonderful year ahead from all of us at {salonName}.',
  ANNIVERSARY: 'Happy anniversary {firstName}! Warm wishes from all of us at {salonName}.',
  APPOINTMENT_CONFIRMATION: 'Hi {firstName}, your appointment at {salonName} is confirmed for {date} at {time}.',
  APPOINTMENT_REMINDER: 'Hi {firstName}, a reminder of your appointment at {salonName} on {date} at {time}. See you soon!',
  BILL_RECEIPT: 'Thank you for visiting {salonName}, {firstName}! Bill {billNumber}: {amount}. Rate your visit: {feedbackLink}',
  PENDING_DUE: 'Hi {firstName}, a balance of {amount} is pending at {salonName}. Please clear it on your next visit.',
  PACKAGE_EXPIRY: 'Hi {firstName}, your {packageName} package at {salonName} expires on {date}. Book now to use it!',
  SERVICE_REMINDER: "Hi {firstName}, it's time for your next {serviceName} at {salonName}. Reply to book a slot!",
  FEEDBACK_REQUEST: 'Hi {firstName}, how was your visit to {salonName}? Tell us here: {feedbackLink}',
  CUSTOM: '{message}',
};

/** Branch messaging settings, or the defaults (CONSOLE everywhere, WhatsApp first) when none are saved. */
export async function messagingSettingsFor(db, branchId) {
  const settings = await db.messagingSettings.findUnique({ where: { branchId } });
  return (
    settings ?? {
      branchId,
      defaultChannel: 'WHATSAPP',
      smsProvider: 'CONSOLE',
      smsConfig: null,
      whatsappProvider: 'CONSOLE',
      whatsappConfig: null,
      emailProvider: 'CONSOLE',
      emailConfig: null,
      updatedAt: null,
    }
  );
}

/** `{ provider, config }` used for `channel`. */
export function providerFor(settings, channel) {
  const fields = CHANNEL_FIELDS[channel];
  return { provider: settings?.[fields.provider] ?? 'CONSOLE', config: settings?.[fields.config] ?? null };
}

/** The client's phone or email for `channel` ('' when missing). */
export const recipientFor = (client, channel) => (channel === 'EMAIL' ? client.email : client.phone) || '';

/** Low-level: queue one message. `db` may be a Prisma transaction client. */
export function queueMessage(db, { branchId, clientId = null, kind, channel, recipient, body, scheduledFor, createdById = null, status }) {
  return db.messageLog.create({
    data: { branchId, clientId, kind, channel, recipient, body, scheduledFor: scheduledFor ?? new Date(), createdById, status },
  });
}

/**
 * Renders templated messages for many clients of one branch, loading settings and templates once.
 * `prepare()` returns MessageLog data (for createMany); `queue()` inserts it.
 */
export function createTemplater(db, branchId) {
  let context;
  const templates = new Map();

  const load = async () => {
    context ??= Promise.all([
      messagingSettingsFor(db, branchId),
      db.branch.findUnique({ where: { id: branchId }, select: { salonName: true } }),
    ]).then(([settings, branch]) => ({ settings, salonName: branch?.salonName ?? '' }));
    return context;
  };

  const templateBody = (kind, channel) => {
    const key = `${kind}:${channel}`;
    if (!templates.has(key)) {
      templates.set(
        key,
        db.messageTemplate
          .findFirst({ where: { branchId, kind, channel, isActive: true }, orderBy: { updatedAt: 'desc' } })
          .then((template) => template?.body ?? DEFAULT_TEMPLATES[kind]),
      );
    }
    return templates.get(key);
  };

  async function prepare({ client, kind, vars = {}, channel, body, scheduledFor, createdById = null }) {
    const { settings, salonName } = await load();
    const useChannel = channel ?? settings.defaultChannel ?? 'WHATSAPP';
    const text = renderTemplate(body ?? (await templateBody(kind, useChannel)), { ...clientVars(client, salonName), ...vars });
    const recipient = recipientFor(client, useChannel);
    return {
      branchId,
      clientId: client.id,
      kind,
      channel: useChannel,
      recipient,
      body: text,
      scheduledFor: scheduledFor ?? new Date(),
      createdById,
      status: recipient ? 'QUEUED' : 'SKIPPED',
    };
  }

  return {
    prepare,
    queue: async (args) => queueMessage(db, await prepare(args)),
  };
}

/**
 * Queue a message for a client using the branch's template for `kind` (or the built-in default) on the branch's
 * default channel. Standard variables: {name}, {firstName}, {salonName}; pass the rest in `vars`.
 * `body` overrides the template text. Recipients without a phone/email for the channel are logged as SKIPPED.
 */
export function queueTemplated(db, { branchId, client, kind, vars = {}, channel, body, scheduledFor, createdById = null }) {
  return createTemplater(db, branchId).queue({ client, kind, vars, channel, body, scheduledFor, createdById });
}
