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

/** Request header carrying the active branch for branch-scoped API routes. */
export const BRANCH_HEADER = 'x-branch-id';
