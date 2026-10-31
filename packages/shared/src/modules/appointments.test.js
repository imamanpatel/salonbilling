import { describe, expect, it } from 'vitest';
import { fieldErrors } from '../schemas.js';
import {
  addMinutesToTime, appointmentSchema, appointmentStatusSchema, appointmentUpdateSchema, minutesToTime, timesOverlap, timeToMinutes,
} from './appointments.js';

const SERVICE_ID = '3f1c2a4e-8b7d-4c1a-9e2f-6a5b4c3d2e1f';
const CLIENT_ID = '7a1c2a4e-8b7d-4c1a-9e2f-6a5b4c3d2e1f';

describe('time helpers', () => {
  it('converts and adds minutes', () => {
    expect(timeToMinutes('10:30')).toBe(630);
    expect(minutesToTime(630)).toBe('10:30');
    expect(addMinutesToTime('10:30', 45)).toBe('11:15');
    expect(addMinutesToTime('23:30', 30)).toBeNull();
  });

  it('treats slots as half-open', () => {
    expect(timesOverlap('10:00', '10:30', '10:30', '11:00')).toBe(false);
    expect(timesOverlap('10:00', '10:30', '10:15', '10:45')).toBe(true);
  });
});

describe('appointmentSchema', () => {
  const valid = {
    clientId: CLIENT_ID,
    date: '2026-10-31',
    items: [{ serviceId: SERVICE_ID, staffId: '', startTime: '10:00', endTime: '', pricePaise: null }],
  };

  it('normalises blanks and applies defaults', () => {
    expect(appointmentSchema.parse(valid)).toEqual({
      ...valid,
      source: 'PHONE',
      notes: null,
      notifyClient: false,
      advance: null,
      items: [{ serviceId: SERVICE_ID, staffId: null, startTime: '10:00', endTime: null, pricePaise: null }],
    });
  });

  it('reports row errors with nested field names', () => {
    const result = appointmentSchema.safeParse({
      ...valid,
      items: [{ serviceId: '', startTime: '11:00', endTime: '10:00' }],
      advance: { amountPaise: 0, method: 'WALLET' },
    });
    expect(fieldErrors(result.error)).toEqual({
      'items.0.serviceId': 'Pick a service',
      'items.0.endTime': 'Must be after the start time',
      'advance.amountPaise': 'Enter an amount',
      'advance.method': 'Pick a payment method',
    });
  });

  it('drops the advance on updates', () => {
    expect(appointmentUpdateSchema.parse({ ...valid, advance: { amountPaise: 100, method: 'CASH' } })).not.toHaveProperty('advance');
  });
});

describe('appointmentStatusSchema', () => {
  it('requires a reason to cancel', () => {
    const result = appointmentStatusSchema.safeParse({ status: 'CANCELLED', cancelReason: ' ' });
    expect(fieldErrors(result.error)).toEqual({ cancelReason: 'Give a reason for cancelling' });
    expect(appointmentStatusSchema.parse({ status: 'CHECKED_IN' })).toEqual({ status: 'CHECKED_IN', cancelReason: null });
  });
});
