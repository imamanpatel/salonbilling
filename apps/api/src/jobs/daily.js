import { Prisma } from '@prisma/client';
import { formatINR } from '@salon/shared';
import { config } from '../config.js';
import { addDaysIso, fromIsoDate } from '../lib/dates.js';
import { createTemplater } from '../services/messaging.js';
import { monthDayWindow } from '../services/occasions.js';
import { businessClock, formatMessageDate, formatMessageTime, zonedDayStart } from './clock.js';

// Automatic reminders, run at most once per branch, job and business date (guarded by a JobRun row).

export const DAILY_START = '09:00';
const MONDAY = 1;
const PACKAGE_EXPIRY_DAYS = 7;
const CLIENT_FIELDS = { id: true, name: true, phone: true, email: true };
const OCCASION_COLUMNS = { dob: Prisma.raw('"dob"'), anniversary: Prisma.raw('"anniversary"') };

async function occasionClients(db, branchId, column, today) {
  const keys = monthDayWindow(today, 1).map(([key]) => key);
  return db.$queryRaw`
    SELECT "id", "name", "phone", "email"
    FROM "Client"
    WHERE "homeBranchId" = ${branchId}
      AND to_char(${OCCASION_COLUMNS[column]}, 'MM-DD') IN (${Prisma.join(keys)})
    ORDER BY "name"`;
}

async function queueAll(templater, items) {
  for (const item of items) await templater.queue(item);
  return items.length;
}

const JOBS = [
  {
    name: 'birthdays',
    enabled: (s) => s.autoBirthday,
    async run(db, { branch, today, templater }) {
      const clients = await occasionClients(db, branch.id, 'dob', today);
      return queueAll(templater, clients.map((client) => ({ client, kind: 'BIRTHDAY' })));
    },
  },
  {
    name: 'anniversaries',
    enabled: (s) => s.autoAnniversary,
    async run(db, { branch, today, templater }) {
      const clients = await occasionClients(db, branch.id, 'anniversary', today);
      return queueAll(templater, clients.map((client) => ({ client, kind: 'ANNIVERSARY' })));
    },
  },
  {
    name: 'appointment-reminders',
    enabled: (s) => s.autoAppointment,
    async run(db, { branch, today, templater }) {
      const tomorrow = addDaysIso(today, 1);
      const appointments = await db.appointment.findMany({
        where: { branchId: branch.id, date: fromIsoDate(tomorrow), status: 'BOOKED' },
        include: { client: { select: CLIENT_FIELDS } },
        orderBy: { startTime: 'asc' },
      });
      return queueAll(
        templater,
        appointments.map((a) => ({
          client: a.client,
          kind: 'APPOINTMENT_REMINDER',
          vars: { date: formatMessageDate(tomorrow), time: formatMessageTime(a.startTime) },
        })),
      );
    },
  },
  {
    name: 'pending-dues',
    enabled: (s, clock) => s.autoPendingPayment && clock.weekday === MONDAY,
    async run(db, { branch, templater }) {
      const dues = await db.bill.groupBy({
        by: ['clientId'],
        where: { branchId: branch.id, status: { not: 'VOID' }, duePaise: { gt: 0 } },
        _sum: { duePaise: true },
      });
      const clients = await db.client.findMany({ where: { id: { in: dues.map((d) => d.clientId) } }, select: CLIENT_FIELDS });
      const byId = new Map(clients.map((c) => [c.id, c]));
      return queueAll(
        templater,
        dues
          .filter((d) => byId.has(d.clientId))
          .map((d) => ({ client: byId.get(d.clientId), kind: 'PENDING_DUE', vars: { amount: formatINR(d._sum.duePaise) } })),
      );
    },
  },
  {
    name: 'package-expiry',
    enabled: (s) => s.autoPackageExpiry,
    async run(db, { branch, today, templater }) {
      const expiresOn = addDaysIso(today, PACKAGE_EXPIRY_DAYS);
      const packages = await db.clientPackage.findMany({
        where: { branchId: branch.id, expiresOn: fromIsoDate(expiresOn), cancelledAt: null },
        include: { client: { select: CLIENT_FIELDS }, package: { select: { name: true } }, items: true },
      });
      return queueAll(
        templater,
        packages
          .filter((p) => p.items.some((item) => item.usedQty < item.totalQty))
          .map((p) => ({
            client: p.client,
            kind: 'PACKAGE_EXPIRY',
            vars: { packageName: p.package.name, date: formatMessageDate(expiresOn) },
          })),
      );
    },
  },
  {
    name: 'service-reminders',
    enabled: () => true,
    async run(db, { branch, today, timeZone, templater }) {
      const rules = await db.serviceReminderRule.findMany({
        where: { branchId: branch.id, isActive: true },
        include: { service: { select: { name: true } } },
      });
      let queued = 0;
      for (const rule of rules) {
        const day = addDaysIso(today, -rule.afterDays);
        const start = zonedDayStart(day, timeZone);
        const end = zonedDayStart(addDaysIso(day, 1), timeZone);
        const billed = await db.billItem.findMany({
          where: { serviceId: rule.serviceId, bill: { branchId: branch.id, status: { not: 'VOID' }, billedAt: { gte: start, lt: end } } },
          select: { bill: { select: { clientId: true } } },
        });
        const clientIds = [...new Set(billed.map((item) => item.bill.clientId))];
        if (!clientIds.length) continue;
        const later = await db.billItem.findMany({
          where: { serviceId: rule.serviceId, bill: { clientId: { in: clientIds }, status: { not: 'VOID' }, billedAt: { gte: end } } },
          select: { bill: { select: { clientId: true } } },
        });
        const returned = new Set(later.map((item) => item.bill.clientId));
        const clients = await db.client.findMany({
          where: { id: { in: clientIds.filter((id) => !returned.has(id)) } },
          select: CLIENT_FIELDS,
          orderBy: { name: 'asc' },
        });
        queued += await queueAll(
          templater,
          clients.map((client) => ({ client, kind: 'SERVICE_REMINDER', body: rule.body, vars: { serviceName: rule.service.name } })),
        );
      }
      return queued;
    },
  },
];

const BRANCH_SETTING_DEFAULTS = {
  autoBirthday: true, autoAnniversary: true, autoAppointment: true, autoPendingPayment: false, autoPackageExpiry: false,
};

const isUniqueViolation = (err) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * Runs each enabled daily job once per active branch and business date, after DAILY_START business time.
 * Returns `{ date, ran: [{ branchId, job, queued }], failed: [{ branchId, job, error }] }`.
 */
export async function runDailyJobs(prisma, { now = new Date(), timeZone = config.timezone, logger } = {}) {
  const clock = businessClock(now, timeZone);
  const summary = { date: clock.date, ran: [], failed: [] };
  if (clock.time < DAILY_START) return summary;

  const branches = await prisma.branch.findMany({ where: { isActive: true }, include: { setting: true }, orderBy: { createdAt: 'asc' } });
  for (const branch of branches) {
    const settings = branch.setting ?? BRANCH_SETTING_DEFAULTS;
    for (const job of JOBS) {
      if (!job.enabled(settings, clock)) continue;
      try {
        // The JobRun row and the queued messages commit together, so a job never half-runs or runs twice.
        const queued = await prisma.$transaction(
          async (tx) => {
            await tx.jobRun.create({ data: { name: job.name, branchId: branch.id, runDate: clock.date } });
            return job.run(tx, { branch, today: clock.date, timeZone, templater: createTemplater(tx, branch.id) });
          },
          { timeout: 120_000, maxWait: 30_000 },
        );
        summary.ran.push({ branchId: branch.id, job: job.name, queued });
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        logger?.error({ err, branchId: branch.id, job: job.name }, 'Daily messaging job failed');
        summary.failed.push({ branchId: branch.id, job: job.name, error: err.message });
      }
    }
  }
  return summary;
}
