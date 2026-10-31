import { z } from 'zod';
import { id, normalizePhone, required } from '../primitives.js';

// M7 Messaging: channels, providers, template placeholders and request schemas.

export const MESSAGE_CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL'];
export const MESSAGE_STATUSES = ['QUEUED', 'SENT', 'FAILED', 'SKIPPED'];
export const MESSAGE_KINDS = [
  'BIRTHDAY', 'ANNIVERSARY', 'APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER', 'BILL_RECEIPT', 'PENDING_DUE',
  'PACKAGE_EXPIRY', 'SERVICE_REMINDER', 'FEEDBACK_REQUEST', 'CUSTOM',
];

export const MESSAGE_PROVIDERS = ['CONSOLE', 'WEBHOOK', 'WHATSAPP_CLOUD'];
/** Providers that can deliver each channel. CONSOLE only logs the message on the server. */
export const CHANNEL_PROVIDERS = {
  SMS: ['CONSOLE', 'WEBHOOK'],
  WHATSAPP: ['CONSOLE', 'WEBHOOK', 'WHATSAPP_CLOUD'],
  EMAIL: ['CONSOLE', 'WEBHOOK'],
};
/** Config keys kept for each provider; anything else is dropped on save. */
export const PROVIDER_CONFIG_KEYS = {
  CONSOLE: [],
  WEBHOOK: ['url', 'headerName', 'headerValue'],
  WHATSAPP_CLOUD: ['phoneNumberId', 'accessToken'],
};
/** Settings field holding each channel's provider / config. */
export const CHANNEL_FIELDS = {
  SMS: { provider: 'smsProvider', config: 'smsConfig' },
  WHATSAPP: { provider: 'whatsappProvider', config: 'whatsappConfig' },
  EMAIL: { provider: 'emailProvider', config: 'emailConfig' },
};

const BASE_PLACEHOLDERS = ['name', 'firstName', 'salonName'];
/** Placeholders each message kind can use, e.g. "Hi {firstName}". */
export const KIND_PLACEHOLDERS = {
  BIRTHDAY: BASE_PLACEHOLDERS,
  ANNIVERSARY: BASE_PLACEHOLDERS,
  APPOINTMENT_CONFIRMATION: [...BASE_PLACEHOLDERS, 'date', 'time'],
  APPOINTMENT_REMINDER: [...BASE_PLACEHOLDERS, 'date', 'time'],
  BILL_RECEIPT: [...BASE_PLACEHOLDERS, 'billNumber', 'amount', 'feedbackLink'],
  PENDING_DUE: [...BASE_PLACEHOLDERS, 'amount'],
  PACKAGE_EXPIRY: [...BASE_PLACEHOLDERS, 'packageName', 'date'],
  SERVICE_REMINDER: [...BASE_PLACEHOLDERS, 'serviceName'],
  FEEDBACK_REQUEST: [...BASE_PLACEHOLDERS, 'feedbackLink'],
  CUSTOM: [...BASE_PLACEHOLDERS, 'message'],
};

/** Example values for template previews. */
export const SAMPLE_VARS = {
  name: 'Priya Sharma',
  firstName: 'Priya',
  salonName: 'Your Salon',
  date: '1 Nov 2026',
  time: '4:30 PM',
  billNumber: 'MAIN-000123',
  amount: '₹1,250.00',
  feedbackLink: 'https://example.com/feedback/abc123',
  packageName: 'Hair Spa x5',
  serviceName: 'Hair colour',
  message: 'Your message here',
};

/** Replace {placeholders} with values; unknown placeholders are left as-is so mistakes are visible. */
export function renderTemplate(body, vars) {
  return body.replace(/\{(\w+)\}/g, (match, key) => (vars[key] === undefined || vars[key] === null ? match : String(vars[key])));
}

/** Standard variables for a client: {name}, {firstName}, {salonName}. */
export const clientVars = (client, salonName) => ({
  name: client.name,
  firstName: client.name.trim().split(/\s+/)[0],
  salonName: salonName ?? '',
});

/** Digits only; 10-digit (Indian) numbers get the 91 country code. "+91 98765-43210" -> "919876543210". */
export function internationalPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

// ─── Secrets ──────────────────────────────────────────────────────────────────

export const SECRET_MASK = '••••';
const SECRET_KEY = /token|key|secret|password|headervalue/i;

export const isSecretKey = (key) => SECRET_KEY.test(key);
export const isMaskedSecret = (value) => typeof value === 'string' && value.startsWith(SECRET_MASK);

/** "abcdef123456" -> "••••3456". Short secrets are fully hidden. */
export function maskSecret(value) {
  if (value === null || value === undefined || value === '') return value;
  const str = String(value);
  return str.length < 8 ? SECRET_MASK : `${SECRET_MASK}${str.slice(-4)}`;
}

/** A provider config with every secret-looking value masked. */
export function maskConfig(config) {
  if (!config || typeof config !== 'object') return null;
  return Object.fromEntries(Object.entries(config).map(([key, value]) => [key, isSecretKey(key) ? maskSecret(value) : value]));
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const configText = (max) =>
  z.preprocess((v) => (typeof v === 'string' ? v.trim() || undefined : (v ?? undefined)), z.string().max(max).optional());

const providerConfigSchema = z.preprocess(
  (v) => v ?? {},
  z.object({
    url: configText(500),
    headerName: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim() || undefined : (v ?? undefined)),
      z.string().max(100).regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and dashes only').optional(),
    ),
    headerValue: configText(500),
    phoneNumberId: configText(50),
    accessToken: configText(1000),
  }),
);

const isWebhookUrl = (url) => /^https:\/\/\S+$/i.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/i.test(url);

function checkProvider(ctx, channel, provider, config) {
  const { provider: providerField, config: configField } = CHANNEL_FIELDS[channel];
  if (!CHANNEL_PROVIDERS[channel].includes(provider)) {
    ctx.addIssue({ code: 'custom', path: [providerField], message: 'Not available for this channel' });
    return;
  }
  const missing = (key, message) => ctx.addIssue({ code: 'custom', path: [configField, key], message });
  if (provider === 'WEBHOOK') {
    if (!config.url) missing('url', 'Webhook URL is required');
    else if (!isWebhookUrl(config.url)) missing('url', 'Use an https:// URL (http:// only for localhost)');
    if (config.headerValue && !config.headerName) missing('headerName', 'Header name is required with a header value');
  }
  if (provider === 'WHATSAPP_CLOUD') {
    if (!config.phoneNumberId) missing('phoneNumberId', 'Phone number ID is required');
    else if (!/^\d+$/.test(config.phoneNumberId)) missing('phoneNumberId', 'Digits only');
    if (!config.accessToken) missing('accessToken', 'Access token is required');
  }
}

/** Keep only the keys the provider uses; CONSOLE has no config. */
function pickConfig(provider, config) {
  const keys = PROVIDER_CONFIG_KEYS[provider] ?? [];
  const picked = Object.fromEntries(keys.filter((key) => config[key] !== undefined).map((key) => [key, config[key]]));
  return Object.keys(picked).length ? picked : null;
}

/** Secrets may be sent back masked ("••••1234") to keep the stored value. */
export const messagingSettingsSchema = z
  .object({
    defaultChannel: z.enum(MESSAGE_CHANNELS),
    smsProvider: z.enum(MESSAGE_PROVIDERS),
    smsConfig: providerConfigSchema,
    whatsappProvider: z.enum(MESSAGE_PROVIDERS),
    whatsappConfig: providerConfigSchema,
    emailProvider: z.enum(MESSAGE_PROVIDERS),
    emailConfig: providerConfigSchema,
  })
  .superRefine((value, ctx) => {
    for (const channel of MESSAGE_CHANNELS) {
      const { provider, config } = CHANNEL_FIELDS[channel];
      checkProvider(ctx, channel, value[provider], value[config]);
    }
  })
  .transform((value) => ({
    ...value,
    smsConfig: pickConfig(value.smsProvider, value.smsConfig),
    whatsappConfig: pickConfig(value.whatsappProvider, value.whatsappConfig),
    emailConfig: pickConfig(value.emailProvider, value.emailConfig),
  }));

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?\d{10,15}$/;

const recipientCheck = (value, ctx) => {
  const ok = value.channel === 'EMAIL' ? EMAIL.test(value.to) : PHONE.test(normalizePhone(value.to));
  if (!ok) ctx.addIssue({ code: 'custom', path: ['to'], message: value.channel === 'EMAIL' ? 'Enter a valid email' : 'Enter a valid phone number' });
};

export const messagingTestSchema = z
  .object({
    channel: z.enum(MESSAGE_CHANNELS),
    to: required('Recipient', 120),
    body: required('Message', 1000),
  })
  .superRefine(recipientCheck);

export const messageTemplateSchema = z.object({
  name: required('Name', 80),
  kind: z.enum(MESSAGE_KINDS),
  channel: z.enum(MESSAGE_CHANNELS),
  body: required('Message', 1000),
  isActive: z.boolean().default(true),
});

export const templatePreviewSchema = z.object({
  body: z.string().max(1000),
  kind: z.enum(MESSAGE_KINDS).default('CUSTOM'),
});

export const sendMessagesSchema = z.object({
  clientIds: z
    .array(id)
    .min(1, 'Pick at least one client')
    .max(1000, 'Pick at most 1000 clients')
    .transform((ids) => [...new Set(ids)]),
  channel: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.enum(MESSAGE_CHANNELS).optional()),
  body: required('Message', 1000),
});

export const reminderRuleSchema = z.object({
  serviceId: z.string().uuid('Pick a service'),
  afterDays: z.coerce.number().int('Whole days only').min(1, 'At least 1 day').max(365, 'At most 365 days'),
  body: required('Message', 1000),
  isActive: z.boolean().default(true),
});
