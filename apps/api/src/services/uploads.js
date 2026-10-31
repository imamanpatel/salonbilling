import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { MAX_GALLERY_UPLOAD, MAX_IMAGE_BYTES } from '@salon/shared/website';
import { config } from '../config.js';
import { badRequest } from '../lib/errors.js';

// Offer and gallery images: stored under <uploadsDir>/<branchId>/<random>.<ext> and served at /uploads.

const EXTENSIONS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const IMAGE_ERROR = 'Only JPG, PNG or WebP images are allowed';

/** Multer for branch-scoped routes (needs req.branchId). Use `.single('image')` or `.array('images', n)`. */
export const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(config.uploadsDir, req.branchId);
      fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
    },
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${EXTENSIONS[file.mimetype]}`),
  }),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_GALLERY_UPLOAD },
  fileFilter: (req, file, cb) => (EXTENSIONS[file.mimetype] ? cb(null, true) : cb(badRequest(IMAGE_ERROR))),
});

/** Public path of an uploaded file. */
export const uploadUrl = (file) => `/uploads/${path.basename(path.dirname(file.path))}/${file.filename}`;

// The declared mime type comes from the browser; check the file really starts like that image format.
const SIGNATURES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

async function looksLikeImage(file) {
  const handle = await fs.promises.open(file.path, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(12), 0, 12, 0);
    return bytesRead === 12 && SIGNATURES[file.mimetype](buffer);
  } finally {
    await handle.close();
  }
}

/** Throws 400 (and deletes the uploads) when any file is not really a JPG/PNG/WebP. */
export async function assertImages(files) {
  const checks = await Promise.all(files.map(looksLikeImage));
  if (checks.every(Boolean)) return;
  await removeFiles(files);
  throw badRequest(IMAGE_ERROR);
}

/** Delete freshly uploaded multer files (e.g. when validation fails afterwards). */
export async function removeFiles(files = []) {
  await Promise.all(files.map((file) => fs.promises.rm(file.path, { force: true })));
}

/** Delete the file behind an `/uploads/...` URL; missing files and foreign URLs are ignored. */
export async function removeUpload(imageUrl) {
  if (!imageUrl?.startsWith('/uploads/')) return;
  const root = path.resolve(config.uploadsDir);
  const file = path.resolve(root, imageUrl.slice('/uploads/'.length));
  if (!file.startsWith(root + path.sep)) return;
  await fs.promises.rm(file, { force: true });
}

/** Runs `fn`; if it throws, the request's uploaded files are deleted before the error propagates. */
export async function cleanupOnError(req, fn) {
  try {
    return await fn();
  } catch (err) {
    await removeFiles([].concat(req.file ?? [], req.files ?? []));
    throw err;
  }
}
