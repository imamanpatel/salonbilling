export const CHANNEL_LABELS = { SMS: 'SMS', WHATSAPP: 'WhatsApp', EMAIL: 'Email' };
export const STATUS_LABELS = { QUEUED: 'Queued', SENT: 'Sent', FAILED: 'Failed', SKIPPED: 'Skipped' };
export const STATUS_TONES = { QUEUED: 'blue', SENT: 'green', FAILED: 'rose', SKIPPED: 'amber' };
export const KIND_LABELS = {
  BIRTHDAY: 'Birthday',
  ANNIVERSARY: 'Anniversary',
  APPOINTMENT_CONFIRMATION: 'Appointment confirmation',
  APPOINTMENT_REMINDER: 'Appointment reminder',
  BILL_RECEIPT: 'Bill receipt',
  PENDING_DUE: 'Pending due',
  PACKAGE_EXPIRY: 'Package expiry',
  SERVICE_REMINDER: 'Service reminder',
  FEEDBACK_REQUEST: 'Feedback request',
  CUSTOM: 'Custom',
};
export const PROVIDER_LABELS = {
  CONSOLE: 'Console (log only, nothing is delivered)',
  WEBHOOK: 'Webhook (your SMS/email gateway)',
  WHATSAPP_CLOUD: 'WhatsApp Cloud API (Meta)',
};
