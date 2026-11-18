-- A bill line can now be credited to several service providers.
CREATE TABLE "BillItemStaff" (
    "id" TEXT NOT NULL,
    "billItemId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "sharePaise" INTEGER NOT NULL,
    "commissionPaise" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BillItemStaff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillItemStaff_billItemId_staffId_key" ON "BillItemStaff"("billItemId", "staffId");
CREATE INDEX "BillItemStaff_staffId_idx" ON "BillItemStaff"("staffId");

ALTER TABLE "BillItemStaff" ADD CONSTRAINT "BillItemStaff_billItemId_fkey" FOREIGN KEY ("billItemId") REFERENCES "BillItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillItemStaff" ADD CONSTRAINT "BillItemStaff_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing lines keep their single provider, who gets the whole line.
INSERT INTO "BillItemStaff" ("id", "billItemId", "staffId", "sharePaise", "commissionPaise")
SELECT gen_random_uuid()::text, "id", "staffId", "totalPaise" - "taxPaise", "commissionPaise"
FROM "BillItem"
WHERE "staffId" IS NOT NULL;

ALTER TABLE "BillItem" DROP CONSTRAINT "BillItem_staffId_fkey";
DROP INDEX "BillItem_staffId_idx";
ALTER TABLE "BillItem" DROP COLUMN "staffId";
