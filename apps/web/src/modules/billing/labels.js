export const METHOD_LABELS = {
  CASH: 'Cash', CARD: 'Card', UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CHEQUE: 'Cheque', WALLET: 'Wallet', GIFT_CARD: 'Gift card', OTHER: 'Other',
};
export const BILL_STATUS_LABELS = { PAID: 'Paid', PARTIAL: 'Due', VOID: 'Void' };
export const BILL_STATUS_TONES = { PAID: 'green', PARTIAL: 'amber', VOID: 'slate' };
export const ITEM_KIND_LABELS = {
  SERVICE: 'Service', PRODUCT: 'Product', PACKAGE: 'Package', MEMBERSHIP: 'Membership', GIFT_CARD: 'Gift card', OPENING_BALANCE: 'Opening balance',
};
export const PAYMENT_KIND_LABELS = { BILL: 'At billing', ADVANCE: 'Advance', DUE_COLLECTION: 'Due collected', WALLET_TOPUP: 'Wallet top-up' };

/** Methods that need a reference (transaction id, cheque no., gift card code). */
export const needsReference = (method) => !['CASH', 'WALLET'].includes(method);
