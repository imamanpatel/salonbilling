import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { id as uuid, isoDate } from '@salon/shared';
import {
  feedbackSchema, fromMinutes, MAX_BOOKING_SERVICES, publicBookingSchema, reviewerName, toMinutes,
} from '@salon/shared/website';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { fromIsoDate, todayIso, toIsoDate } from '../../lib/dates.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { queryString } from '../../lib/http.js';
import { validateBody } from '../../middleware/validate.js';
import { randomReferralCode } from '../../services/clients.js';
import { branchSlots, nowTimeIn } from '../../services/slots.js';

// No sign-in: the online booking page, a salon's own website (CORS) and feedback links sent to clients.
// Responses never include client data or internal ids other than service ids.
export const mount = { path: '/public', scope: 'public' };

const router = Router();

router.use((req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

const limiter = (limit, message) =>
  rateLimit({
    windowMs: 60 * 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message } }),
  });
const bookingLimiter = limiter(10, 'Too many booking attempts. Please try again later or call the salon.');
const feedbackLimiter = limiter(20, 'Too many attempts. Please try again later.');

const businessToday = () => todayIso(config.timezone);
const absoluteUrl = (req, url) => (url?.startsWith('/') ? `${req.protocol}://${req.get('host')}${url}` : url);

async function findBranch(slug) {
  const branch = await prisma.branch.findFirst({ where: { slug: String(slug).toLowerCase(), isActive: true } });
  if (!branch) throw notFound('Salon');
  return branch;
}

/** Active, website-visible services of the branch for `ids` (duplicates allowed), or 400. */
async function bookableServices(db, branchId, ids) {
  const rows = await db.service.findMany({ where: { id: { in: [...new Set(ids)] }, branchId, isActive: true, showOnWebsite: true } });
  const byId = new Map(rows.map((s) => [s.id, s]));
  if (!ids.every((serviceId) => byId.has(serviceId))) {
    throw badRequest('Some of the chosen services are not available online', { serviceIds: 'Pick services from the list' });
  }
  return ids.map((serviceId) => byId.get(serviceId));
}

const totalDuration = (services) => services.reduce((sum, s) => sum + s.durationMin, 0);

// ── Feedback (by the secret token on a bill) ─────────────────────────────────

async function findFeedbackBill(token) {
  const bill = await prisma.bill.findUnique({
    where: { feedbackToken: token },
    include: { client: { select: { id: true, name: true, phone: true } }, feedback: { select: { id: true } } },
  });
  if (!bill || bill.status === 'VOID') throw notFound('Feedback link');
  return bill;
}

router.get('/feedback/:token', async (req, res) => {
  const bill = await findFeedbackBill(req.params.token);
  const branch = await prisma.branch.findUnique({ where: { id: bill.branchId }, select: { salonName: true } });
  res.json({
    data: {
      salonName: branch.salonName,
      clientFirstName: bill.client.name.trim().split(/\s+/)[0],
      billNumber: bill.number,
      billedAt: bill.billedAt,
      alreadySubmitted: Boolean(bill.feedback),
    },
  });
});

router.post('/feedback/:token', feedbackLimiter, validateBody(feedbackSchema), async (req, res) => {
  const bill = await findFeedbackBill(req.params.token);
  if (bill.feedback) throw conflict('Thanks, we already have your feedback for this visit');
  const feedback = await prisma.feedback.create({
    data: {
      ...req.body,
      branchId: bill.branchId,
      clientId: bill.client.id,
      billId: bill.id,
      name: bill.client.name,
      phone: bill.client.phone,
    },
  });
  const { rating, serviceRating, staffRating, ambienceRating, comment } = feedback;
  res.status(201).json({ data: { rating, serviceRating, staffRating, ambienceRating, comment } });
});

// ── Salon by slug ────────────────────────────────────────────────────────────

router.get('/:slug', async (req, res) => {
  const branch = await findBranch(req.params.slug);
  const setting = await prisma.branchSetting.findUnique({ where: { branchId: branch.id }, select: { onlineBooking: true } });
  const { salonName, name, address, phone, email, website, openTime, closeTime } = branch;
  res.json({
    data: { salonName, name, address, phone, email, website, openTime, closeTime, onlineBooking: setting?.onlineBooking ?? false },
  });
});

router.get('/:slug/services', async (req, res) => {
  const branch = await findBranch(req.params.slug);
  const services = await prisma.service.findMany({
    where: { branchId: branch.id, isActive: true, showOnWebsite: true },
    select: { id: true, name: true, durationMin: true, pricePaise: true, gender: true, category: { select: { name: true } } },
    orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
  });
  const categories = new Map();
  for (const { category, ...service } of services) {
    if (!categories.has(category.name)) categories.set(category.name, { name: category.name, services: [] });
    categories.get(category.name).services.push(service);
  }
  res.json({ data: { categories: [...categories.values()] } });
});

router.get('/:slug/offers', async (req, res) => {
  const branch = await findBranch(req.params.slug);
  const offers = await prisma.offer.findMany({
    where: { branchId: branch.id, isActive: true, OR: [{ validTo: null }, { validTo: { gte: fromIsoDate(businessToday()) } }] },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
  });
  res.json({
    data: offers.map((o) => ({ title: o.title, description: o.description, imageUrl: absoluteUrl(req, o.imageUrl), validTo: toIsoDate(o.validTo) })),
  });
});

router.get('/:slug/gallery', async (req, res) => {
  const branch = await findBranch(req.params.slug);
  const photos = await prisma.galleryPhoto.findMany({ where: { branchId: branch.id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] });
  res.json({ data: photos.map((p) => ({ imageUrl: absoluteUrl(req, p.imageUrl), caption: p.caption })) });
});

const reviewDate = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });

router.get('/:slug/reviews', async (req, res) => {
  const branch = await findBranch(req.params.slug);
  const where = { branchId: branch.id, isApproved: true };
  const [stats, latest] = await Promise.all([
    prisma.feedback.aggregate({ where, _avg: { rating: true }, _count: true }),
    prisma.feedback.findMany({ where, orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  res.json({
    data: {
      averageRating: stats._avg.rating === null ? null : Math.round(stats._avg.rating * 10) / 10,
      count: stats._count,
      items: latest.map((f) => ({ name: reviewerName(f.name), rating: f.rating, comment: f.comment, date: reviewDate.format(f.createdAt) })),
    },
  });
});

router.get('/:slug/slots', async (req, res) => {
  const branch = await findBranch(req.params.slug);
  const date = queryString(req, 'date');
  if (!isoDate.safeParse(date).success) throw badRequest('Pick a date', { date: 'Use YYYY-MM-DD' });
  const ids = queryString(req, 'serviceIds').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length || ids.length > MAX_BOOKING_SERVICES) {
    throw badRequest(`Pick 1 to ${MAX_BOOKING_SERVICES} services`, { serviceIds: `Pick 1 to ${MAX_BOOKING_SERVICES} services` });
  }
  if (!ids.every((serviceId) => uuid.safeParse(serviceId).success)) throw badRequest('Pick services from the list', { serviceIds: 'Pick services from the list' });

  const services = await bookableServices(prisma, branch.id, ids);
  const slots = await branchSlots(prisma, {
    branch,
    date,
    durationMin: totalDuration(services),
    today: businessToday(),
    nowTime: nowTimeIn(config.timezone),
  });
  res.json({ data: { date, slots } });
});

router.post('/:slug/bookings', bookingLimiter, validateBody(publicBookingSchema), async (req, res) => {
  const branch = await findBranch(req.params.slug);
  const setting = await prisma.branchSetting.findUnique({ where: { branchId: branch.id }, select: { onlineBooking: true } });
  if (!setting?.onlineBooking) {
    throw new AppError(403, 'BOOKING_DISABLED', 'This salon is not taking online bookings right now. Please call to book.');
  }
  const { name, phone, email, date, time, serviceIds, notes } = req.body;

  const appointment = await prisma.$transaction(async (tx) => {
    const services = await bookableServices(tx, branch.id, serviceIds);
    const slots = await branchSlots(tx, {
      branch,
      date,
      durationMin: totalDuration(services),
      today: businessToday(),
      nowTime: nowTimeIn(config.timezone),
    });
    if (!slots.includes(time)) {
      throw conflict('Sorry, that time is no longer available. Please pick another slot.', { time: 'No longer available' });
    }

    const organizationId = branch.organizationId;
    const client =
      (await tx.client.findUnique({ where: { organizationId_phone: { organizationId, phone } }, select: { id: true } })) ??
      (await tx.client.create({
        data: {
          organizationId,
          homeBranchId: branch.id,
          name,
          phone,
          email,
          gender: 'OTHER',
          source: 'WEBSITE',
          referralCode: randomReferralCode(),
        },
        select: { id: true },
      }));

    let cursor = toMinutes(time);
    const items = services.map((service) => {
      const item = { serviceId: service.id, startTime: fromMinutes(cursor), endTime: fromMinutes(cursor + service.durationMin), pricePaise: service.pricePaise };
      cursor += service.durationMin;
      return item;
    });
    const created = await tx.appointment.create({
      data: {
        branchId: branch.id,
        clientId: client.id,
        date: fromIsoDate(date),
        startTime: time,
        endTime: fromMinutes(cursor),
        status: 'REQUESTED',
        source: 'WEBSITE',
        notes,
        items: { create: items },
      },
    });
    return { ...created, services };
  });

  res.status(201).json({
    data: {
      reference: appointment.id.slice(0, 8).toUpperCase(),
      date,
      time,
      endTime: appointment.endTime,
      services: appointment.services.map((s) => ({ id: s.id, name: s.name, durationMin: s.durationMin, pricePaise: s.pricePaise })),
    },
  });
});

export default router;
