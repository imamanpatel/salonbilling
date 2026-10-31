import pino from 'pino';

const env = process.env.NODE_ENV;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (env === 'test' ? 'silent' : 'info'),
  transport: env === 'production' || env === 'test' ? undefined : { target: 'pino-pretty', options: { colorize: true } },
  redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
});
