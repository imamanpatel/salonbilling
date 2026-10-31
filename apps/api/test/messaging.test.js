import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BRANCH_HEADER } from '@salon/shared';
import { sendMessage, WHATSAPP_CLOUD_URL } from '../src/services/messageProviders.js';
import { login, resetDatabase, seedBase } from './helpers.js';

const TZ = 'Asia/Kolkata';
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

/** A fetch stand-in that records requests and answers with `status` / `json`. */
function fakeFetch({ status = 200, json = {} } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body), signal: init.signal });
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  };
  fetch.calls = calls;
  return fetch;
}

describe('message providers', () => {
  const base = { channel: 'WHATSAPP', to: '+91 98765-43210', body: 'Hello', kind: 'CUSTOM' };

  it('CONSOLE logs instead of delivering', async () => {
    const lines = [];
    const result = await sendMessage({ ...base, provider: 'CONSOLE', logger: { info: (obj) => lines.push(obj) } });
    expect(result).toEqual({ ok: true, providerRef: 'console' });
    expect(lines[0]).toMatchObject({ to: '919876543210', body: 'Hello' });
  });

  it('WEBHOOK posts the message with the optional auth header', async () => {
    const fetch = fakeFetch({ json: { id: 42 } });
    const config = { url: 'https://hooks.test/send', headerName: 'X-Api-Key', headerValue: 'secret' };
    const result = await sendMessage({ ...base, channel: 'SMS', to: '98765 43210', provider: 'WEBHOOK', config, fetch });
    expect(result).toEqual({ ok: true, providerRef: '42' });
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0].url).toBe('https://hooks.test/send');
    expect(fetch.calls[0].headers).toMatchObject({ 'Content-Type': 'application/json', 'X-Api-Key': 'secret' });
    expect(fetch.calls[0].body).toEqual({ channel: 'SMS', to: '919876543210', body: 'Hello', kind: 'CUSTOM' });
    expect(fetch.calls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it('WEBHOOK reports non-2xx responses', async () => {
    const fetch = fakeFetch({ status: 502, json: { message: 'gateway down' } });
    const result = await sendMessage({ ...base, provider: 'WEBHOOK', config: { url: 'https://hooks.test' }, fetch });
    expect(result).toEqual({ ok: false, error: 'Provider responded 502: gateway down' });
  });

  it('WHATSAPP_CLOUD calls the Graph API and returns the message id', async () => {
    const fetch = fakeFetch({ json: { messages: [{ id: 'wamid.ABC' }] } });
    const config = { phoneNumberId: '1234567890', accessToken: 'EAAG-token' };
    const result = await sendMessage({ ...base, provider: 'WHATSAPP_CLOUD', config, fetch });
    expect(result).toEqual({ ok: true, providerRef: 'wamid.ABC' });
    expect(fetch.calls[0].url).toBe(`${WHATSAPP_CLOUD_URL}/1234567890/messages`);
    expect(fetch.calls[0].url).toBe('https://graph.facebook.com/v21.0/1234567890/messages');
    expect(fetch.calls[0].headers.Authorization).toBe('Bearer EAAG-token');
    expect(fetch.calls[0].body).toEqual({ messaging_product: 'whatsapp', to: '919876543210', type: 'text', text: { body: 'Hello' } });
  });

  it('WHATSAPP_CLOUD surfaces Graph API errors and missing config', async () => {
    const fetch = fakeFetch({ status: 401, json: { error: { message: 'Invalid OAuth access token' } } });
    const config = { phoneNumberId: '1', accessToken: 'bad' };
    expect(await sendMessage({ ...base, provider: 'WHATSAPP_CLOUD', config, fetch })).toEqual({
      ok: false,
      error: 'Provider responded 401: Invalid OAuth access token',
    });
    expect((await sendMessage({ ...base, provider: 'WHATSAPP_CLOUD', config: null, fetch })).ok).toBe(false);
  });

  it('times out slow providers and never throws', async () => {
    const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    const slow = await sendMessage({ ...base, provider: 'WEBHOOK', config: { url: 'https://hooks.test' }, fetch: hang, timeoutMs: 20 });
    expect(slow).toEqual({ ok: false, error: 'Provider did not respond within 0.02 s' });

    const broken = async () => {
      throw new TypeError('fetch failed');
    };
    const down = await sendMessage({ ...base, provider: 'WEBHOOK', config: { url: 'https://hooks.test' }, fetch: broken });
    expect(down).toEqual({ ok: false, error: 'Could not reach provider: fetch failed' });
  });

  it('rejects unknown providers and missing recipients', async () => {
    expect(await sendMessage({ ...base, provider: 'PIGEON' })).toEqual({ ok: false, error: 'Unknown provider PIGEON' });
    expect(await sendMessage({ ...base, to: '', provider: 'CONSOLE' })).toEqual({ ok: false, error: 'No recipient' });
  });

  it('does not touch email addresses', async () => {
    const fetch = fakeFetch();
    await sendMessage({ ...base, channel: 'EMAIL', to: ' a@b.test ', provider: 'WEBHOOK', config: { url: 'https://hooks.test' }, fetch });
    expect(fetch.calls[0].body.to).toBe('a@b.test');
  });
});

// Requires TEST_DATABASE_URL pointing at a *_test database; it is wiped.
describe.skipIf(!process.env.TEST_DATABASE_URL)('messaging API and jobs', () => {
  let app;
  let prisma;
  let fx;
  let runSender;
  let runDailyJobs;
  let queueTemplated;
  let seq = 0;

  beforeAll(async () => {
    ({ prisma } = await import('../src/db.js'));
    const { createApp } = await import('../src/app.js');
    ({ runSender, runDailyJobs } = await import('../src/jobs/index.js'));
    ({ queueTemplated } = await import('../src/services/messaging.js'));
    app = createApp();
    await resetDatabase(prisma);
    fx = await seedBase(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const as = async (username, branchId = fx.a1) => {
    const agent = await login(app, username);
    const withBranch = (method) => (url) => agent[method](`/api/messaging${url}`).set(BRANCH_HEADER, branchId);
    return { get: withBranch('get'), post: withBranch('post'), put: withBranch('put'), delete: withBranch('delete') };
  };

  const makeClient = (data = {}) => {
    seq += 1;
    return prisma.client.create({
      data: {
        organizationId: fx.orgA,
        homeBranchId: fx.a1,
        name: `Client ${seq}`,
        phone: `93${String(seq).padStart(8, '0')}`,
        gender: 'FEMALE',
        referralCode: `MSG${seq}`,
        ...data,
      },
    });
  };

  const settingsPayload = (overrides = {}) => ({
    defaultChannel: 'WHATSAPP',
    smsProvider: 'CONSOLE',
    smsConfig: null,
    whatsappProvider: 'CONSOLE',
    whatsappConfig: null,
    emailProvider: 'CONSOLE',
    emailConfig: null,
    ...overrides,
  });

  describe('settings', () => {
    it('front desk cannot read or change settings', async () => {
      const desk = await as('desk');
      expect((await desk.get('/settings')).status).toBe(403);
      expect((await desk.put('/settings').send(settingsPayload())).status).toBe(403);
      expect((await desk.post('/test').send({ channel: 'SMS', to: '9876543210', body: 'Hi' })).status).toBe(403);
    });

    it('returns CONSOLE defaults when nothing is saved', async () => {
      const admin = await as('admin');
      const res = await admin.get('/settings').expect(200);
      expect(res.body.data).toMatchObject(settingsPayload());
    });

    it('masks secrets and keeps them when sent back masked', async () => {
      const admin = await as('admin');
      const saved = await admin
        .put('/settings')
        .send(
          settingsPayload({
            smsProvider: 'WEBHOOK',
            smsConfig: { url: 'https://hooks.test/sms', headerName: 'X-Api-Key', headerValue: 'hook-secret-5555' },
            whatsappProvider: 'WHATSAPP_CLOUD',
            whatsappConfig: { phoneNumberId: '1234567890', accessToken: 'EAAG-secret-token-9876' },
          }),
        )
        .expect(200);
      expect(saved.body.data.smsConfig).toEqual({ url: 'https://hooks.test/sms', headerName: 'X-Api-Key', headerValue: '••••5555' });
      expect(saved.body.data.whatsappConfig).toEqual({ phoneNumberId: '1234567890', accessToken: '••••9876' });

      const current = (await admin.get('/settings').expect(200)).body.data;
      expect(JSON.stringify(current)).not.toContain('secret');
      await admin.put('/settings').send({ ...current, defaultChannel: 'SMS' }).expect(200);

      const stored = await prisma.messagingSettings.findUnique({ where: { branchId: fx.a1 } });
      expect(stored.defaultChannel).toBe('SMS');
      expect(stored.smsConfig.headerValue).toBe('hook-secret-5555');
      expect(stored.whatsappConfig.accessToken).toBe('EAAG-secret-token-9876');
    });

    it('validates provider config', async () => {
      const admin = await as('admin');
      const missing = await admin.put('/settings').send(settingsPayload({ whatsappProvider: 'WHATSAPP_CLOUD', whatsappConfig: { phoneNumberId: '123' } }));
      expect(missing.status).toBe(400);
      expect(missing.body.error.details).toEqual({ 'whatsappConfig.accessToken': 'Access token is required' });

      const insecure = await admin.put('/settings').send(settingsPayload({ smsProvider: 'WEBHOOK', smsConfig: { url: 'http://example.com/hook' } }));
      expect(insecure.body.error.details).toEqual({ 'smsConfig.url': 'Use an https:// URL (http:// only for localhost)' });

      // A masked secret can't be reused for a provider that never had one.
      const boss = await as('boss', fx.a2);
      const masked = await boss
        .put('/settings')
        .send(settingsPayload({ whatsappProvider: 'WHATSAPP_CLOUD', whatsappConfig: { phoneNumberId: '123', accessToken: '••••9876' } }));
      expect(masked.status).toBe(400);
      expect(masked.body.error.details).toEqual({ 'whatsappConfig.accessToken': 'Enter the value again' });
    });

    it('keeps settings per branch', async () => {
      const boss = await as('boss', fx.a2);
      expect((await boss.get('/settings').expect(200)).body.data.whatsappProvider).toBe('CONSOLE');
    });

    it('sends a test message without logging it', async () => {
      const boss = await as('boss', fx.a2);
      const before = await prisma.messageLog.count();
      const res = await boss.post('/test').send({ channel: 'WHATSAPP', to: '98765 43210', body: 'Test' }).expect(200);
      expect(res.body.data).toEqual({ ok: true, providerRef: 'console', provider: 'CONSOLE' });
      expect(await prisma.messageLog.count()).toBe(before);

      const bad = await boss.post('/test').send({ channel: 'EMAIL', to: '98765 43210', body: 'Test' });
      expect(bad.body.error.details).toEqual({ to: 'Enter a valid email' });
    });
  });

  describe('templates', () => {
    let templateId;

    it('lets managers write and everyone read', async () => {
      const desk = await as('desk');
      const admin = await as('admin');
      const body = { name: 'Birthday WA', kind: 'BIRTHDAY', channel: 'WHATSAPP', body: 'Hey {firstName}! Love, {salonName}' };
      expect((await desk.post('/templates').send(body)).status).toBe(403);

      const created = await admin.post('/templates').send(body).expect(201);
      templateId = created.body.data.id;
      expect(created.body.data).toMatchObject({ ...body, isActive: true, branchId: fx.a1 });
      expect((await admin.post('/templates').send(body)).status).toBe(409);
      expect((await admin.post('/templates').send({ ...body, name: 'Long', body: 'x'.repeat(1001) })).status).toBe(400);

      const list = await desk.get('/templates').expect(200);
      expect(list.body.data.map((t) => t.name)).toEqual(['Birthday WA']);
    });

    it('describes defaults and placeholders per kind', async () => {
      const desk = await as('desk');
      const { kinds } = (await desk.get('/templates/defaults').expect(200)).body.data;
      const receipt = kinds.find((k) => k.kind === 'BILL_RECEIPT');
      expect(receipt.placeholders).toEqual(['name', 'firstName', 'salonName', 'billNumber', 'amount', 'feedbackLink']);
      expect(receipt.defaultBody).toContain('{billNumber}');
      expect(kinds).toHaveLength(10);
    });

    it('previews a body with sample values', async () => {
      const desk = await as('desk');
      const res = await desk.post('/templates/preview').send({ body: 'Hi {firstName} from {salonName}, {nope}', kind: 'BIRTHDAY' }).expect(200);
      expect(res.body.data.body).toBe('Hi Priya from Salon A, {nope}');
    });

    it('is used by queueTemplated for its kind and channel', async () => {
      const client = await prisma.client.findUnique({ where: { id: fx.client } });
      const log = await queueTemplated(prisma, { branchId: fx.a1, client, kind: 'BIRTHDAY', channel: 'WHATSAPP' });
      expect(log.body).toBe('Hey Test! Love, Salon A');
      const sms = await queueTemplated(prisma, { branchId: fx.a1, client, kind: 'BIRTHDAY', channel: 'SMS' });
      expect(sms.body).toBe('Happy birthday Test! Wishing you a wonderful year ahead from all of us at Salon A.');

      const admin = await as('admin');
      await admin
        .put(`/templates/${templateId}`)
        .send({ name: 'Birthday WA', kind: 'BIRTHDAY', channel: 'WHATSAPP', body: 'Off', isActive: false })
        .expect(200);
      const inactive = await queueTemplated(prisma, { branchId: fx.a1, client, kind: 'BIRTHDAY', channel: 'WHATSAPP' });
      expect(inactive.body).toContain('Happy birthday Test!');
      await prisma.messageLog.deleteMany();
    });

    it('cannot touch another branch template', async () => {
      const other = await prisma.messageTemplate.create({ data: { branchId: fx.a2, name: 'A2', kind: 'CUSTOM', channel: 'SMS', body: 'x' } });
      const admin = await as('admin');
      expect((await admin.put(`/templates/${other.id}`).send({ name: 'x', kind: 'CUSTOM', channel: 'SMS', body: 'y' })).status).toBe(404);
      expect((await admin.delete(`/templates/${other.id}`)).status).toBe(404);
      await admin.delete(`/templates/${templateId}`).expect(204);
      expect(await prisma.messageTemplate.count({ where: { branchId: fx.a1 } })).toBe(0);
    });
  });

  describe('sending and the message log', () => {
    let withEmail;
    let noEmail;

    beforeAll(async () => {
      await prisma.messageLog.deleteMany();
      withEmail = await makeClient({ name: 'Esha Mail', email: 'esha@example.test' });
      noEmail = await makeClient({ name: 'Nina Phone' });
    });

    it('queues one message per client and skips missing contacts', async () => {
      const desk = await as('desk');
      const res = await desk
        .post('/send')
        .send({ clientIds: [withEmail.id, noEmail.id], channel: 'EMAIL', body: 'Hi {firstName}, offers at {salonName}!' })
        .expect(201);
      expect(res.body.data).toEqual({ queued: 1, skipped: 1 });

      const logs = await prisma.messageLog.findMany({ where: { kind: 'CUSTOM' }, orderBy: { status: 'asc' } });
      expect(logs.map((l) => [l.status, l.recipient, l.body])).toEqual([
        ['QUEUED', 'esha@example.test', 'Hi Esha, offers at Salon A!'],
        ['SKIPPED', '', 'Hi Nina, offers at Salon A!'],
      ]);
      expect(logs[0].createdById).toBe(fx.users.desk);

      // Without a channel the branch default (SMS, set above) is used.
      const sms = await desk.post('/send').send({ clientIds: [noEmail.id], body: 'Hello' }).expect(201);
      expect(sms.body.data).toEqual({ queued: 1, skipped: 0 });
    });

    it('rejects clients of another organisation', async () => {
      const outsider = await prisma.client.create({
        data: { organizationId: fx.orgB, name: 'Outsider', phone: '9999999999', gender: 'MALE', referralCode: 'OUTSIDER' },
      });
      const desk = await as('desk');
      const res = await desk.post('/send').send({ clientIds: [outsider.id], body: 'Hi' });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual({ clientIds: 'Some clients were not found' });
    });

    it('filters the log', async () => {
      const desk = await as('desk');
      const all = (await desk.get('/logs').expect(200)).body.data;
      expect(all.total).toBe(3);
      expect(all.items[0].client).toEqual({ id: noEmail.id, name: 'Nina Phone' });

      const skipped = (await desk.get('/logs?status=SKIPPED').expect(200)).body.data;
      expect(skipped.items.map((l) => l.client.name)).toEqual(['Nina Phone']);
      expect((await desk.get('/logs?channel=EMAIL').expect(200)).body.data.total).toBe(2);
      expect((await desk.get('/logs?channel=SMS&kind=CUSTOM').expect(200)).body.data.total).toBe(1);
      expect((await desk.get('/logs?kind=BIRTHDAY').expect(200)).body.data.total).toBe(0);
      expect((await desk.get('/logs?q=esha').expect(200)).body.data.total).toBe(1);
      expect((await desk.get('/logs?q=example.test').expect(200)).body.data.total).toBe(1);
      expect((await desk.get('/logs?q=nina').expect(200)).body.data.total).toBe(2);

      const today = istToday();
      expect((await desk.get(`/logs?from=${today}&to=${today}`).expect(200)).body.data.total).toBe(3);
      expect((await desk.get('/logs?to=2020-01-01').expect(200)).body.data.total).toBe(0);
      const paged = (await desk.get('/logs?pageSize=2&page=2').expect(200)).body.data;
      expect(paged).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(paged.items).toHaveLength(1);
    });

    it('summarises the last 7 days', async () => {
      const desk = await as('desk');
      const res = await desk.get('/summary').expect(200);
      expect(res.body.data.counts).toEqual({ QUEUED: 2, SENT: 0, FAILED: 0, SKIPPED: 1 });
    });

    it('retries skipped and failed messages only', async () => {
      const desk = await as('desk');
      const skipped = await prisma.messageLog.findFirst({ where: { status: 'SKIPPED' } });
      const noContact = await desk.post(`/logs/${skipped.id}/retry`);
      expect(noContact.status).toBe(400);
      expect(noContact.body.error.message).toBe('This client has no email address');

      await prisma.client.update({ where: { id: noEmail.id }, data: { email: 'nina@example.test' } });
      const retried = await desk.post(`/logs/${skipped.id}/retry`).expect(200);
      expect(retried.body.data).toMatchObject({ status: 'QUEUED', recipient: 'nina@example.test', attempts: 0, error: null });

      const queued = await desk.post(`/logs/${skipped.id}/retry`);
      expect(queued.status).toBe(400);

      const failed = await prisma.messageLog.update({
        where: { id: skipped.id },
        data: { status: 'FAILED', attempts: 3, error: 'Provider responded 500' },
      });
      await desk.post(`/logs/${failed.id}/retry`).expect(200);
    });

    it('keeps logs per branch', async () => {
      const boss = await as('boss', fx.a2);
      expect((await boss.get('/logs').expect(200)).body.data.total).toBe(0);
      const log = await prisma.messageLog.findFirst({ where: { branchId: fx.a1 } });
      expect((await boss.post(`/logs/${log.id}/retry`)).status).toBe(404);
    });
  });

  describe('reminder rules', () => {
    it('validates the service and lets only managers write', async () => {
      const admin = await as('admin');
      const desk = await as('desk');
      const rule = { serviceId: fx.colour, afterDays: 30, body: 'Hi {firstName}, time for {serviceName}?' };
      expect((await desk.post('/reminder-rules').send(rule)).status).toBe(403);

      const created = await admin.post('/reminder-rules').send(rule).expect(201);
      expect(created.body.data).toMatchObject({ ...rule, isActive: true, service: { name: 'Hair colour' } });
      expect((await admin.post('/reminder-rules').send(rule)).status).toBe(409);
      expect((await admin.post('/reminder-rules').send({ ...rule, afterDays: 400 })).status).toBe(400);

      const otherBranchService = await prisma.service.create({
        data: { branchId: fx.a2, categoryId: fx.category, name: 'Elsewhere', durationMin: 30, pricePaise: 100, memberPricePaise: 100 },
      });
      const wrong = await admin.post('/reminder-rules').send({ ...rule, serviceId: otherBranchService.id });
      expect(wrong.body.error.details).toEqual({ serviceId: 'Pick an active service of this branch' });

      const updated = await admin.put(`/reminder-rules/${created.body.data.id}`).send({ ...rule, afterDays: 45 }).expect(200);
      expect(updated.body.data.afterDays).toBe(45);
      expect((await desk.get('/reminder-rules').expect(200)).body.data).toHaveLength(1);

      await admin.delete(`/reminder-rules/${created.body.data.id}`).expect(204);
      expect(await prisma.serviceReminderRule.count()).toBe(0);
    });
  });

  describe('sender job', () => {
    const NOW = new Date('2026-11-02T04:30:00Z');
    const later = (minutes) => new Date(NOW.getTime() + minutes * 60_000);
    const queue = (data = {}) =>
      prisma.messageLog.create({
        data: { branchId: fx.a1, kind: 'CUSTOM', channel: 'WHATSAPP', recipient: '9876543210', body: 'Hi', scheduledFor: later(-1), ...data },
      });

    beforeAll(async () => {
      await prisma.messageLog.deleteMany();
      await prisma.messagingSettings.update({
        where: { branchId: fx.a1 },
        data: { whatsappProvider: 'WEBHOOK', whatsappConfig: { url: 'https://hooks.test/wa' } },
      });
    });

    it('sends due messages with the branch provider', async () => {
      const due = await queue();
      const future = await queue({ scheduledFor: later(60) });
      const calls = [];
      const send = async (args) => {
        calls.push(args);
        return { ok: true, providerRef: 'ref-1' };
      };

      expect(await runSender(prisma, { now: NOW, send })).toEqual({ sent: 1, retrying: 0, failed: 0 });
      expect(calls).toEqual([
        expect.objectContaining({ channel: 'WHATSAPP', provider: 'WEBHOOK', config: { url: 'https://hooks.test/wa' }, to: '9876543210', body: 'Hi' }),
      ]);
      expect(await prisma.messageLog.findUnique({ where: { id: due.id } })).toMatchObject({
        status: 'SENT', provider: 'WEBHOOK', providerRef: 'ref-1', sentAt: NOW, attempts: 1, error: null,
      });
      expect((await prisma.messageLog.findUnique({ where: { id: future.id } })).status).toBe('QUEUED');
      await prisma.messageLog.deleteMany();
    });

    it('backs off after failures and gives up after 3 attempts', async () => {
      const log = await queue();
      const fail = async () => ({ ok: false, error: 'boom' });

      expect(await runSender(prisma, { now: NOW, send: fail })).toEqual({ sent: 0, retrying: 1, failed: 0 });
      let row = await prisma.messageLog.findUnique({ where: { id: log.id } });
      expect(row).toMatchObject({ status: 'QUEUED', attempts: 1, error: 'boom', scheduledFor: later(5) });

      // Not due yet: nothing happens.
      expect(await runSender(prisma, { now: later(4), send: fail })).toEqual({ sent: 0, retrying: 0, failed: 0 });

      await runSender(prisma, { now: later(5), send: async () => { throw new Error('crashed'); } });
      row = await prisma.messageLog.findUnique({ where: { id: log.id } });
      expect(row).toMatchObject({ status: 'QUEUED', attempts: 2, error: 'crashed', scheduledFor: later(15) });

      expect(await runSender(prisma, { now: later(15), send: fail })).toEqual({ sent: 0, retrying: 0, failed: 1 });
      row = await prisma.messageLog.findUnique({ where: { id: log.id } });
      expect(row).toMatchObject({ status: 'FAILED', attempts: 3, error: 'boom' });
      await prisma.messageLog.deleteMany();
    });

    it('takes the oldest messages first, up to the batch size', async () => {
      const oldest = await queue({ scheduledFor: later(-30) });
      const middle = await queue({ scheduledFor: later(-20) });
      const newest = await queue({ scheduledFor: later(-10) });
      const sent = [];
      await runSender(prisma, { now: NOW, batchSize: 2, send: async ({ body }) => (sent.push(body), { ok: true }) });
      const statuses = await prisma.messageLog.findMany({ where: { id: { in: [oldest.id, middle.id, newest.id] } } });
      const byId = Object.fromEntries(statuses.map((s) => [s.id, s.status]));
      expect([byId[oldest.id], byId[middle.id], byId[newest.id]]).toEqual(['SENT', 'SENT', 'QUEUED']);
      expect(sent).toHaveLength(2);
      await prisma.messageLog.deleteMany();
    });
  });

  describe('daily jobs', () => {
    // Monday 2 Nov 2026, 10:00 in Kolkata.
    const NOW = new Date('2026-11-02T04:30:00Z');
    let billNo = 0;
    let people;

    const bill = (clientId, { billedAt = NOW, status = 'PAID', duePaise = 0, branchId = fx.a1, serviceId } = {}) => {
      billNo += 1;
      return prisma.bill.create({
        data: {
          branchId,
          number: `T-${billNo}`,
          clientId,
          billedAt,
          status,
          subtotalPaise: 250000,
          discountPaise: 0,
          taxPaise: 0,
          totalPaise: 250000,
          paidPaise: 250000 - duePaise,
          duePaise,
          createdById: fx.users.admin,
          items: serviceId
            ? { create: [{ kind: 'SERVICE', name: 'Service', serviceId, qty: 1, unitPricePaise: 250000, discountPaise: 0, taxPaise: 0, totalPaise: 250000 }] }
            : undefined,
        },
      });
    };

    const logsOf = (kind) => prisma.messageLog.findMany({ where: { branchId: fx.a1, kind }, orderBy: { body: 'asc' } });

    beforeAll(async () => {
      await prisma.messageLog.deleteMany();
      await prisma.jobRun.deleteMany();
      await prisma.messagingSettings.update({ where: { branchId: fx.a1 }, data: { defaultChannel: 'WHATSAPP', whatsappProvider: 'CONSOLE', whatsappConfig: null } });
      await prisma.branchSetting.update({
        where: { branchId: fx.a1 },
        data: { autoBirthday: true, autoAnniversary: true, autoAppointment: true, autoPendingPayment: true, autoPackageExpiry: true },
      });

      people = {
        birthday: await makeClient({ name: 'Bina Birthday', dob: new Date('1990-11-02') }),
        otherBranchBirthday: await makeClient({ name: 'Olga Other', dob: new Date('1991-11-02'), homeBranchId: fx.a2 }),
        notToday: await makeClient({ name: 'Nora Notyet', dob: new Date('1990-11-03') }),
        anniversary: await makeClient({ name: 'Anil Anniversary', anniversary: new Date('2015-11-02') }),
        appointment: await makeClient({ name: 'Appu Booked' }),
        cancelled: await makeClient({ name: 'Cara Cancelled' }),
        debtor: await makeClient({ name: 'Devi Due' }),
        packaged: await makeClient({ name: 'Pia Package' }),
        usedUp: await makeClient({ name: 'Uma Usedup' }),
        colour: await makeClient({ name: 'Rita Return' }),
        returned: await makeClient({ name: 'Ravi Repeat' }),
        tooEarly: await makeClient({ name: 'Tara Thirtyone' }),
      };

      const appointment = (clientId, date, status, startTime = '16:30') =>
        prisma.appointment.create({ data: { branchId: fx.a1, clientId, date: new Date(date), startTime, endTime: '17:00', status } });
      await appointment(people.appointment.id, '2026-11-03', 'BOOKED');
      await appointment(people.cancelled.id, '2026-11-03', 'CANCELLED');
      await appointment(people.cancelled.id, '2026-11-02', 'BOOKED');

      await bill(people.debtor.id, { status: 'PARTIAL', duePaise: 30000 });
      await bill(people.debtor.id, { status: 'PARTIAL', duePaise: 20000 });
      await bill(people.debtor.id, { status: 'VOID', duePaise: 99900 });
      await bill(people.debtor.id, { status: 'PARTIAL', duePaise: 70000, branchId: fx.a2 });

      const pkg = await prisma.package.create({ data: { branchId: fx.a1, name: 'Hair Spa x5', pricePaise: 500000, validityDays: 90 } });
      const clientPackage = (clientId, expiresOn, usedQty, extra = {}) =>
        prisma.clientPackage.create({
          data: {
            clientId,
            packageId: pkg.id,
            branchId: fx.a1,
            purchasedOn: new Date('2026-08-01'),
            expiresOn: new Date(expiresOn),
            items: { create: [{ serviceId: fx.haircut, totalQty: 5, usedQty }] },
            ...extra,
          },
        });
      await clientPackage(people.packaged.id, '2026-11-09', 2);
      await clientPackage(people.usedUp.id, '2026-11-09', 5);
      await clientPackage(people.packaged.id, '2026-11-09', 0, { cancelledAt: new Date('2026-10-01') });
      await clientPackage(people.packaged.id, '2026-11-10', 0);

      await prisma.serviceReminderRule.create({
        data: { branchId: fx.a1, serviceId: fx.colour, afterDays: 30, body: 'Hi {firstName}, your {serviceName} touch-up is due at {salonName}.' },
      });
      // 30 business days before 2 Nov is 3 Oct; 23:30 IST on 3 Oct is still that day.
      await bill(people.colour.id, { billedAt: new Date('2026-10-03T18:00:00Z'), serviceId: fx.colour });
      await bill(people.returned.id, { billedAt: new Date('2026-10-03T06:30:00Z'), serviceId: fx.colour });
      await bill(people.returned.id, { billedAt: new Date('2026-10-20T06:30:00Z'), serviceId: fx.colour });
      await bill(people.tooEarly.id, { billedAt: new Date('2026-10-02T06:30:00Z'), serviceId: fx.colour });
      await bill(people.tooEarly.id, { billedAt: new Date('2026-10-03T07:00:00Z'), serviceId: fx.colour, status: 'VOID' });
    });

    it('waits until 09:00 business time', async () => {
      const summary = await runDailyJobs(prisma, { now: new Date('2026-11-02T03:00:00Z'), timeZone: TZ });
      expect(summary).toEqual({ date: '2026-11-02', ran: [], failed: [] });
      expect(await prisma.jobRun.count()).toBe(0);
    });

    it('queues every enabled reminder for the branch', async () => {
      const summary = await runDailyJobs(prisma, { now: NOW, timeZone: TZ });
      expect(summary.failed).toEqual([]);
      const a1 = Object.fromEntries(summary.ran.filter((r) => r.branchId === fx.a1).map((r) => [r.job, r.queued]));
      expect(a1).toEqual({
        birthdays: 1, anniversaries: 1, 'appointment-reminders': 1, 'pending-dues': 1, 'package-expiry': 1, 'service-reminders': 1,
      });
      // A2 keeps the default settings: no pending-due or package reminders.
      expect(summary.ran.filter((r) => r.branchId === fx.a2).map((r) => r.job)).toEqual([
        'birthdays', 'anniversaries', 'appointment-reminders', 'service-reminders',
      ]);

      expect((await logsOf('BIRTHDAY')).map((l) => [l.clientId, l.body, l.status, l.channel])).toEqual([
        [people.birthday.id, 'Happy birthday Bina! Wishing you a wonderful year ahead from all of us at Salon A.', 'QUEUED', 'WHATSAPP'],
      ]);
      expect((await logsOf('ANNIVERSARY')).map((l) => l.clientId)).toEqual([people.anniversary.id]);
      expect((await logsOf('APPOINTMENT_REMINDER')).map((l) => [l.clientId, l.body])).toEqual([
        [people.appointment.id, 'Hi Appu, a reminder of your appointment at Salon A on 3 Nov 2026 at 4:30 PM. See you soon!'],
      ]);
      expect((await logsOf('PENDING_DUE')).map((l) => [l.clientId, l.body])).toEqual([
        [people.debtor.id, 'Hi Devi, a balance of ₹500.00 is pending at Salon A. Please clear it on your next visit.'],
      ]);
      expect((await logsOf('PACKAGE_EXPIRY')).map((l) => [l.clientId, l.body])).toEqual([
        [people.packaged.id, 'Hi Pia, your Hair Spa x5 package at Salon A expires on 9 Nov 2026. Book now to use it!'],
      ]);
      expect((await logsOf('SERVICE_REMINDER')).map((l) => [l.clientId, l.body])).toEqual([
        [people.colour.id, 'Hi Rita, your Hair colour touch-up is due at Salon A.'],
      ]);

      const a2Birthdays = await prisma.messageLog.findMany({ where: { branchId: fx.a2, kind: 'BIRTHDAY' } });
      expect(a2Birthdays.map((l) => l.clientId)).toEqual([people.otherBranchBirthday.id]);
    });

    it('runs each job once per business day', async () => {
      const before = await prisma.messageLog.count();
      const again = await runDailyJobs(prisma, { now: new Date(NOW.getTime() + 2 * 3_600_000), timeZone: TZ });
      expect(again.ran).toEqual([]);
      expect(await prisma.messageLog.count()).toBe(before);
      expect(await prisma.jobRun.count({ where: { branchId: fx.a1, runDate: '2026-11-02' } })).toBe(6);
    });

    it('sends pending-due reminders on Mondays only', async () => {
      const tuesday = await runDailyJobs(prisma, { now: new Date('2026-11-03T04:30:00Z'), timeZone: TZ });
      const jobs = tuesday.ran.filter((r) => r.branchId === fx.a1).map((r) => r.job);
      expect(jobs).not.toContain('pending-dues');
      expect(jobs).toContain('birthdays');
      // Nora's birthday is on the 3rd.
      expect((await logsOf('BIRTHDAY')).map((l) => l.clientId)).toContain(people.notToday.id);
    });
  });
});
