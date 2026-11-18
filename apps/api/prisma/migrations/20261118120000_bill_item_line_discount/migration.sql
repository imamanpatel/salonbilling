-- Kept so a bill can be edited with its line discounts as entered.
ALTER TABLE "BillItem" ADD COLUMN "lineDiscountPaise" INTEGER;
