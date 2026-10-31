import { describe, expect, it } from 'vitest';
import { fieldErrors } from '../schemas.js';
import {
  clientVars, internationalPhone, isMaskedSecret, isSecretKey, maskConfig, maskSecret, messagingSettingsSchema, messagingTestSchema,
  reminderRuleSchema, renderTemplate, sendMessagesSchema,
} from './messaging.js';

const CLIENT_ID = '3f1c2a4e-8b7d-4c1a-9e2f-6a5b4c3d2e1f';
const consoleSettings = {
  defaultChannel: 'WHATSAPP',
  smsProvider: 'CONSOLE',
  smsConfig: null,
  whatsappProvider: 'CONSOLE',
  whatsappConfig: null,
  emailProvider: 'CONSOLE',
  emailConfig: null,
};

describe('renderTemplate', () => {
  it('fills known placeholders and leaves unknown ones visible', () => {
    expect(renderTemplate('Hi {firstName}, see you at {time} {oops}', { firstName: 'Asha', time: '4 PM' })).toBe('Hi Asha, see you at 4 PM {oops}');
  });

  it('builds the standard client variables', () => {
    expect(clientVars({ name: '  Asha  Rao ' }, 'Glow')).toEqual({ name: '  Asha  Rao ', firstName: 'Asha', salonName: 'Glow' });
  });
});

describe('internationalPhone', () => {
  it.each([
    ['98765 43210', '919876543210'],
    ['+91 98765-43210', '919876543210'],
    ['(044) 1234-5678', '04412345678'],
    ['+1 415 555 0100', '14155550100'],
  ])('%j -> %j', (input, expected) => {
    expect(internationalPhone(input)).toBe(expected);
  });
});

describe('secrets', () => {
  it('recognises secret-looking keys', () => {
    expect(['accessToken', 'apiKey', 'clientSecret', 'password', 'headerValue'].every(isSecretKey)).toBe(true);
    expect(['url', 'headerName', 'phoneNumberId'].some(isSecretKey)).toBe(false);
  });

  it('masks all but the last 4 characters', () => {
    expect(maskSecret('EAAG-secret-1234')).toBe('••••1234');
    expect(maskSecret('short')).toBe('••••');
    expect(isMaskedSecret('••••1234')).toBe(true);
    expect(maskConfig({ phoneNumberId: '1234567890', accessToken: 'EAAG-secret-1234' })).toEqual({
      phoneNumberId: '1234567890',
      accessToken: '••••1234',
    });
    expect(maskConfig(null)).toBeNull();
  });
});

describe('messagingSettingsSchema', () => {
  it('accepts console providers and drops their config', () => {
    const parsed = messagingSettingsSchema.parse({ ...consoleSettings, smsConfig: { url: 'https://x.test' } });
    expect(parsed).toEqual(consoleSettings);
  });

  it('requires a secure webhook URL', () => {
    const result = messagingSettingsSchema.safeParse({ ...consoleSettings, smsProvider: 'WEBHOOK', smsConfig: { url: 'http://example.com' } });
    expect(fieldErrors(result.error)).toEqual({ 'smsConfig.url': 'Use an https:// URL (http:// only for localhost)' });

    const local = messagingSettingsSchema.parse({ ...consoleSettings, smsProvider: 'WEBHOOK', smsConfig: { url: 'http://localhost:9000/sms', headerName: '', phoneNumberId: '1' } });
    expect(local.smsConfig).toEqual({ url: 'http://localhost:9000/sms' });
  });

  it('requires WhatsApp Cloud credentials and only allows it for WhatsApp', () => {
    const result = messagingSettingsSchema.safeParse({ ...consoleSettings, whatsappProvider: 'WHATSAPP_CLOUD', emailProvider: 'WHATSAPP_CLOUD' });
    expect(fieldErrors(result.error)).toEqual({
      'whatsappConfig.phoneNumberId': 'Phone number ID is required',
      'whatsappConfig.accessToken': 'Access token is required',
      emailProvider: 'Not available for this channel',
    });
  });
});

describe('request schemas', () => {
  it('validates the test recipient for the channel', () => {
    expect(messagingTestSchema.safeParse({ channel: 'SMS', to: '98765 43210', body: 'Hi' }).success).toBe(true);
    const bad = messagingTestSchema.safeParse({ channel: 'EMAIL', to: '98765 43210', body: 'Hi' });
    expect(fieldErrors(bad.error)).toEqual({ to: 'Enter a valid email' });
  });

  it('de-duplicates clients and limits bulk sends', () => {
    expect(sendMessagesSchema.parse({ clientIds: [CLIENT_ID, CLIENT_ID], channel: '', body: 'Hi {firstName}' })).toEqual({
      clientIds: [CLIENT_ID],
      body: 'Hi {firstName}',
    });
    expect(sendMessagesSchema.safeParse({ clientIds: Array(1001).fill(CLIENT_ID), body: 'Hi' }).success).toBe(false);
    expect(fieldErrors(sendMessagesSchema.safeParse({ clientIds: [], body: '' }).error)).toEqual({
      clientIds: 'Pick at least one client',
      body: 'Message is required',
    });
  });

  it('coerces reminder days and checks the range', () => {
    expect(reminderRuleSchema.parse({ serviceId: CLIENT_ID, afterDays: '30', body: 'Hi' })).toEqual({
      serviceId: CLIENT_ID, afterDays: 30, body: 'Hi', isActive: true,
    });
    expect(fieldErrors(reminderRuleSchema.safeParse({ serviceId: '', afterDays: 0, body: 'Hi' }).error)).toEqual({
      serviceId: 'Pick a service',
      afterDays: 'At least 1 day',
    });
  });
});
