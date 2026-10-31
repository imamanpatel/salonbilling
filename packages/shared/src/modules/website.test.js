import { describe, expect, it } from 'vitest';
import { feedbackSchema, fromMinutes, offerSchema, publicBookingSchema, reviewerName, toMinutes } from './website.js';

const SERVICE = '6f1c1d1e-8a0b-4c55-9a43-1c2d3e4f5a6b';

describe('website schemas', () => {
  it('validates a public booking', () => {
    const ok = publicBookingSchema.safeParse({ name: ' Riya ', phone: '98765 43210', date: '2026-11-02', time: '10:30', serviceIds: [SERVICE] });
    expect(ok.success).toBe(true);
    expect(ok.data).toMatchObject({ name: 'Riya', phone: '9876543210', email: null, notes: null });

    const bad = publicBookingSchema.safeParse({ name: '', phone: '12', date: 'soon', time: '25:00', serviceIds: [] });
    expect(bad.error.issues.map((i) => i.path[0]).sort()).toEqual(['date', 'name', 'phone', 'serviceIds', 'time']);
    expect(publicBookingSchema.safeParse({ name: 'A', phone: '9876543210', date: '2026-11-02', time: '10:00', serviceIds: Array(6).fill(SERVICE) }).success).toBe(false);
  });

  it('requires an overall rating and keeps sub-ratings optional', () => {
    expect(feedbackSchema.safeParse({}).error.issues[0]).toMatchObject({ path: ['rating'], message: 'Pick a rating' });
    expect(feedbackSchema.parse({ rating: 5, serviceRating: '', staffRating: 4 })).toEqual({
      rating: 5, serviceRating: null, staffRating: 4, ambienceRating: null, comment: null,
    });
    expect(feedbackSchema.safeParse({ rating: 6 }).success).toBe(false);
    expect(feedbackSchema.safeParse({ rating: 3, comment: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('parses multipart offer fields', () => {
    expect(offerSchema.parse({ title: 'Diwali', sortOrder: '2', isActive: 'false', validTo: '' })).toEqual({
      title: 'Diwali', description: null, validTo: null, sortOrder: 2, isActive: false, removeImage: false,
    });
    expect(offerSchema.parse({ title: 'Monsoon', isActive: true }).sortOrder).toBe(0);
  });

  it('formats reviewer names and times', () => {
    expect(reviewerName('Riya Sharma')).toBe('Riya S.');
    expect(reviewerName('  asha  ')).toBe('asha');
    expect(reviewerName('Anil kumar verma')).toBe('Anil V.');
    expect(toMinutes('09:45')).toBe(585);
    expect(fromMinutes(585)).toBe('09:45');
  });
});
