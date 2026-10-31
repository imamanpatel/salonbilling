import { describe, expect, it } from 'vitest';
import { fieldErrors, serviceSchema, staffSchema, userUpdateSchema } from './schemas.js';

const CATEGORY_ID = '3f1c2a4e-8b7d-4c1a-9e2f-6a5b4c3d2e1f';

describe('serviceSchema', () => {
  const valid = {
    categoryId: CATEGORY_ID,
    name: ' Haircut ',
    gender: 'FEMALE',
    durationMin: '45',
    pricePaise: 49900,
    memberPricePaise: 44900,
  };

  it('trims, coerces and applies defaults', () => {
    expect(serviceSchema.parse(valid)).toEqual({
      ...valid,
      name: 'Haircut',
      durationMin: 45,
      rewardPoints: 0,
      showOnWebsite: true,
      isActive: true,
    });
  });

  it('rejects a member price above the regular price', () => {
    const result = serviceSchema.safeParse({ ...valid, memberPricePaise: 50000 });
    expect(result.success).toBe(false);
    expect(fieldErrors(result.error)).toEqual({ memberPricePaise: 'Member price cannot be more than the regular price' });
  });

  it('rejects fractional paise', () => {
    expect(serviceSchema.safeParse({ ...valid, pricePaise: 499.5 }).success).toBe(false);
  });
});

describe('staffSchema', () => {
  it('turns blank optional fields into null', () => {
    const parsed = staffSchema.parse({
      kind: 'SERVICE_PROVIDER',
      name: 'Test Stylist',
      phone: '9000000001',
      email: '',
      gender: 'FEMALE',
      dob: '',
      joinedOn: '2026-10-01',
      emergencyPhone: '',
      monthlySalaryPaise: 1500000,
      shiftStart: '10:00',
      shiftEnd: '',
      serviceCommissionPct: '10',
    });
    expect(parsed).toMatchObject({ email: null, dob: null, emergencyPhone: null, shiftEnd: null, serviceCommissionPct: 10, productCommissionPct: 0 });
  });

  it('rejects bad phone numbers and times', () => {
    const result = staffSchema.safeParse({
      kind: 'STAFF', name: 'X', phone: '12', gender: 'MALE', joinedOn: '2026-10-01', monthlySalaryPaise: 0, shiftStart: '25:00',
    });
    expect(Object.keys(fieldErrors(result.error))).toEqual(expect.arrayContaining(['phone', 'shiftStart']));
  });
});

describe('userUpdateSchema', () => {
  it('treats a blank password as "keep current" and dedupes branches', () => {
    const parsed = userUpdateSchema.parse({ name: 'Desk', role: 'USER', branchIds: [CATEGORY_ID, CATEGORY_ID], password: '' });
    expect(parsed.password).toBeUndefined();
    expect(parsed.branchIds).toEqual([CATEGORY_ID]);
  });
});
