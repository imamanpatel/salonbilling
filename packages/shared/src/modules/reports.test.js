import { describe, expect, it } from 'vitest';
import { fieldErrors } from '../schemas.js';
import { presetRange, rangeDays, REDEMPTION_METHODS, reportRangeSchema } from './reports.js';

describe('presetRange', () => {
  const today = '2026-10-29'; // a Thursday

  it('resolves day presets', () => {
    expect(presetRange('today', today)).toEqual({ from: today, to: today });
    expect(presetRange('yesterday', today)).toEqual({ from: '2026-10-28', to: '2026-10-28' });
    expect(presetRange('yesterday', '2026-03-01')).toEqual({ from: '2026-02-28', to: '2026-02-28' });
  });

  it('starts weeks on Monday', () => {
    expect(presetRange('this-week', today)).toEqual({ from: '2026-10-26', to: today });
    expect(presetRange('this-week', '2026-10-26')).toEqual({ from: '2026-10-26', to: '2026-10-26' });
    expect(presetRange('this-week', '2026-11-01')).toEqual({ from: '2026-10-26', to: '2026-11-01' }); // Sunday
  });

  it('resolves month presets across year ends', () => {
    expect(presetRange('this-month', today)).toEqual({ from: '2026-10-01', to: today });
    expect(presetRange('last-month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetRange('last-month', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetRange('last-month', '2024-03-31')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });

  it('returns null for custom', () => {
    expect(presetRange('custom', today)).toBeNull();
  });
});

describe('reportRangeSchema', () => {
  const errors = (input) => fieldErrors(reportRangeSchema.safeParse(input).error);

  it('accepts a valid range', () => {
    expect(reportRangeSchema.parse({ from: '2026-10-01', to: '2026-10-31' })).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(rangeDays('2026-10-01', '2026-10-31')).toBe(31);
  });

  it('rejects missing, malformed and impossible dates', () => {
    expect(errors({ to: '2026-10-01' })).toEqual({ from: 'From date is required' });
    expect(errors({ from: '01/10/2026', to: '2026-10-01' })).toEqual({ from: 'Use YYYY-MM-DD' });
    expect(errors({ from: '2026-02-30', to: '2026-03-01' })).toEqual({ from: 'Enter a valid date' });
  });

  it('rejects reversed and over-long ranges', () => {
    expect(errors({ from: '2026-10-02', to: '2026-10-01' })).toEqual({ to: 'Must be on or after the from date' });
    expect(reportRangeSchema.safeParse({ from: '2025-10-31', to: '2026-10-31' }).success).toBe(true); // 366 days
    expect(errors({ from: '2025-10-30', to: '2026-10-31' })).toEqual({ to: 'Pick a range of at most 366 days' });
  });

  it('treats wallet and gift cards as redemptions', () => {
    expect(REDEMPTION_METHODS).toEqual(['WALLET', 'GIFT_CARD']);
  });
});
