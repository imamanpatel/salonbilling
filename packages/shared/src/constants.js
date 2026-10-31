export const ROLES = Object.freeze({
  SUPERADMIN: 'SUPERADMIN',
  ADMIN: 'ADMIN',
  USER: 'USER',
});

export const STAFF_KINDS = Object.freeze({
  SERVICE_PROVIDER: 'SERVICE_PROVIDER',
  STAFF: 'STAFF',
});

export const GENDERS = ['FEMALE', 'MALE', 'OTHER'];
export const SERVICE_GENDERS = ['FEMALE', 'MALE', 'UNISEX'];
export const TAX_APPLIES_TO = ['SERVICE', 'PRODUCT', 'ALL'];
export const DEPARTMENTS = ['Front desk', 'Sales', 'Management', 'Accounts', 'Housekeeping', 'Others'];

export const LEAD_SOURCES = ['WALK_IN', 'REFERRAL', 'PHONE', 'INSTAGRAM', 'FACEBOOK', 'GOOGLE', 'WEBSITE', 'JUSTDIAL', 'OTHER'];
export const ENQUIRY_TYPES = ['HOT', 'WARM', 'COLD'];
export const ENQUIRY_STATUSES = ['PENDING', 'CONVERTED', 'CLOSED'];

/** All payment methods. WALLET and GIFT_CARD only apply to bill payments. */
export const PAYMENT_METHODS = ['CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'WALLET', 'GIFT_CARD', 'OTHER'];
/** Methods for money that actually changes hands (advances, top-ups, salaries, expenses, purchases). */
export const CASH_METHODS = ['CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'];

/** Request header carrying the active branch for branch-scoped API routes. */
export const BRANCH_HEADER = 'x-branch-id';
