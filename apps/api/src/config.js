import { fileURLToPath } from 'node:url';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name} (see apps/api/.env.example)`);
  return value;
}

const isProd = process.env.NODE_ENV === 'production';
const jwtSecret = required('JWT_SECRET');
if (isProd && jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production');

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  jwtSecret,
  sessionHours: Number(process.env.SESSION_HOURS ?? 12),
  /** "Today" for follow-ups, birthdays and reports is computed in this zone, not the server's. */
  timezone: process.env.BUSINESS_TIMEZONE ?? 'Asia/Kolkata',
  /** Where uploaded images are stored; served at /uploads. */
  uploadsDir: process.env.UPLOADS_DIR ?? fileURLToPath(new URL('../uploads/', import.meta.url)),
  /** Built web app (npm run build). Served by the API when present, for single-service hosts like Render. */
  webDir: process.env.WEB_DIST ?? fileURLToPath(new URL('../../web/dist/', import.meta.url)),
  /** Public address of the web app, used in links sent to clients (feedback, booking). */
  appUrl: (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
};
