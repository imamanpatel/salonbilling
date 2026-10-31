import { Router } from 'express';
import { ROLES } from '@salon/shared';
import {
  feedbackModerationSchema, galleryPhotoSchema, galleryUploadSchema, MAX_GALLERY_UPLOAD, offerSchema, onlineBookingSchema,
} from '@salon/shared/website';
import { prisma } from '../../db.js';
import { fromIsoDate, toIsoDate } from '../../lib/dates.js';
import { badRequest } from '../../lib/errors.js';
import { findInBranch, pageParams, queryString } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { assertImages, cleanupOnError, imageUpload, removeUpload, uploadUrl } from '../../services/uploads.js';

// Website admin for the active branch: booking link, offers, gallery and feedback moderation.
export const mount = { path: '/website', scope: 'branch' };

const router = Router();
const canWrite = requireRole(ROLES.SUPERADMIN, ROLES.ADMIN);

const offerDto = (offer) => ({ ...offer, validTo: toIsoDate(offer.validTo) });

router.get('/info', async (req, res) => {
  const setting = await prisma.branchSetting.findUnique({ where: { branchId: req.branchId }, select: { onlineBooking: true } });
  const { name, salonName, slug } = req.branch;
  res.json({ data: { name, salonName, slug, onlineBooking: setting?.onlineBooking ?? false } });
});

router.patch('/booking', canWrite, validateBody(onlineBookingSchema), async (req, res) => {
  const setting = await prisma.branchSetting.upsert({
    where: { branchId: req.branchId },
    create: { branchId: req.branchId, onlineBooking: req.body.onlineBooking },
    update: { onlineBooking: req.body.onlineBooking },
  });
  res.json({ data: { onlineBooking: setting.onlineBooking } });
});

// ── Offers ───────────────────────────────────────────────────────────────────

router.get('/offers', async (req, res) => {
  const offers = await prisma.offer.findMany({ where: { branchId: req.branchId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] });
  res.json({ data: offers.map(offerDto) });
});

router.post('/offers', canWrite, imageUpload.single('image'), async (req, res) => {
  const offer = await cleanupOnError(req, async () => {
    const { removeImage, validTo, ...body } = offerSchema.parse(req.body ?? {});
    if (req.file) await assertImages([req.file]);
    return prisma.offer.create({
      data: { ...body, validTo: fromIsoDate(validTo), imageUrl: req.file ? uploadUrl(req.file) : null, branchId: req.branchId },
    });
  });
  res.status(201).json({ data: offerDto(offer) });
});

router.put('/offers/:id', canWrite, imageUpload.single('image'), async (req, res) => {
  const { existing, offer } = await cleanupOnError(req, async () => {
    const current = await findInBranch(prisma.offer, req.params.id, req.branchId, 'Offer');
    const { removeImage, validTo, ...body } = offerSchema.parse(req.body ?? {});
    if (req.file) await assertImages([req.file]);
    const imageUrl = req.file ? uploadUrl(req.file) : removeImage ? null : current.imageUrl;
    const updated = await prisma.offer.update({ where: { id: current.id }, data: { ...body, validTo: fromIsoDate(validTo), imageUrl } });
    return { existing: current, offer: updated };
  });
  if (existing.imageUrl && existing.imageUrl !== offer.imageUrl) await removeUpload(existing.imageUrl);
  res.json({ data: offerDto(offer) });
});

router.delete('/offers/:id', canWrite, async (req, res) => {
  const offer = await findInBranch(prisma.offer, req.params.id, req.branchId, 'Offer');
  await prisma.offer.delete({ where: { id: offer.id } });
  await removeUpload(offer.imageUrl);
  res.status(204).end();
});

// ── Gallery ──────────────────────────────────────────────────────────────────

router.get('/gallery', async (req, res) => {
  const photos = await prisma.galleryPhoto.findMany({ where: { branchId: req.branchId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] });
  res.json({ data: photos });
});

router.post('/gallery', canWrite, imageUpload.array('images', MAX_GALLERY_UPLOAD), async (req, res) => {
  const photos = await cleanupOnError(req, async () => {
    if (!req.files?.length) throw badRequest('Choose at least one image', { images: 'Choose at least one image' });
    const { caption } = galleryUploadSchema.parse(req.body ?? {});
    await assertImages(req.files);
    return prisma.$transaction(
      req.files.map((file) => prisma.galleryPhoto.create({ data: { branchId: req.branchId, imageUrl: uploadUrl(file), caption } })),
    );
  });
  res.status(201).json({ data: photos });
});

router.patch('/gallery/:id', canWrite, validateBody(galleryPhotoSchema), async (req, res) => {
  await findInBranch(prisma.galleryPhoto, req.params.id, req.branchId, 'Photo');
  const photo = await prisma.galleryPhoto.update({ where: { id: req.params.id }, data: req.body });
  res.json({ data: photo });
});

router.delete('/gallery/:id', canWrite, async (req, res) => {
  const photo = await findInBranch(prisma.galleryPhoto, req.params.id, req.branchId, 'Photo');
  await prisma.galleryPhoto.delete({ where: { id: photo.id } });
  await removeUpload(photo.imageUrl);
  res.status(204).end();
});

// ── Feedback moderation ──────────────────────────────────────────────────────

const FEEDBACK_FILTERS = { pending: { isApproved: false }, approved: { isApproved: true }, all: {} };

router.get('/feedback', async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req);
  const where = { branchId: req.branchId, ...(FEEDBACK_FILTERS[queryString(req, 'status')] ?? FEEDBACK_FILTERS.all) };
  const [items, total, byRating] = await prisma.$transaction([
    prisma.feedback.findMany({
      where,
      include: { client: { select: { id: true, name: true } }, bill: { select: { id: true, number: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.feedback.count({ where }),
    prisma.feedback.groupBy({ by: ['rating'], where: { branchId: req.branchId }, _count: { _all: true }, orderBy: { rating: 'asc' } }),
  ]);

  const byStars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let count = 0;
  let sum = 0;
  for (const row of byRating) {
    byStars[row.rating] = row._count._all;
    count += row._count._all;
    sum += row.rating * row._count._all;
  }
  const summary = { averageRating: count ? Math.round((sum / count) * 10) / 10 : null, count, byStars };
  res.json({ data: { items, total, page, pageSize, summary } });
});

router.patch('/feedback/:id', canWrite, validateBody(feedbackModerationSchema), async (req, res) => {
  await findInBranch(prisma.feedback, req.params.id, req.branchId, 'Feedback');
  const feedback = await prisma.feedback.update({
    where: { id: req.params.id },
    data: { isApproved: req.body.isApproved },
    include: { client: { select: { id: true, name: true } }, bill: { select: { id: true, number: true } } },
  });
  res.json({ data: feedback });
});

export default router;
