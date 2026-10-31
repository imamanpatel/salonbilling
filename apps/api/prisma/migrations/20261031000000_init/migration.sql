-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPERADMIN', 'ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "StaffKind" AS ENUM ('SERVICE_PROVIDER', 'STAFF');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('FEMALE', 'MALE', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceGender" AS ENUM ('FEMALE', 'MALE', 'UNISEX');

-- CreateEnum
CREATE TYPE "TaxAppliesTo" AS ENUM ('SERVICE', 'PRODUCT', 'ALL');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "salonName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "gstin" TEXT,
    "address" TEXT,
    "openTime" TEXT NOT NULL DEFAULT '10:00',
    "closeTime" TEXT NOT NULL DEFAULT '20:00',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBranch" (
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "UserBranch_pkey" PRIMARY KEY ("userId","branchId")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "kind" "StaffKind" NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "gender" "Gender" NOT NULL,
    "dob" DATE,
    "joinedOn" DATE NOT NULL,
    "address" TEXT,
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "monthlySalaryPaise" INTEGER NOT NULL DEFAULT 0,
    "shiftStart" TEXT,
    "shiftEnd" TEXT,
    "serviceCommissionPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "productCommissionPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "designation" TEXT,
    "department" TEXT,
    "attendanceCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCategory" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" "ServiceGender" NOT NULL DEFAULT 'UNISEX',
    "durationMin" INTEGER NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "memberPricePaise" INTEGER NOT NULL,
    "rewardPoints" INTEGER NOT NULL DEFAULT 0,
    "showOnWebsite" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ratePct" DECIMAL(5,2) NOT NULL,
    "appliesTo" "TaxAppliesTo" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchSetting" (
    "branchId" TEXT NOT NULL,
    "autoBirthday" BOOLEAN NOT NULL DEFAULT true,
    "autoAnniversary" BOOLEAN NOT NULL DEFAULT true,
    "autoAppointment" BOOLEAN NOT NULL DEFAULT true,
    "autoPendingPayment" BOOLEAN NOT NULL DEFAULT false,
    "autoPackageExpiry" BOOLEAN NOT NULL DEFAULT false,
    "redeemPoints" INTEGER NOT NULL DEFAULT 1,
    "redeemValuePaise" INTEGER NOT NULL DEFAULT 100,
    "maxRedeemPoints" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchSetting_pkey" PRIMARY KEY ("branchId")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Branch_organizationId_name_key" ON "Branch"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Staff_branchId_kind_isActive_idx" ON "Staff"("branchId", "kind", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_branchId_phone_key" ON "Staff"("branchId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategory_branchId_name_key" ON "ServiceCategory"("branchId", "name");

-- CreateIndex
CREATE INDEX "Service_branchId_isActive_idx" ON "Service"("branchId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Service_branchId_categoryId_name_key" ON "Service"("branchId", "categoryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRate_branchId_name_key" ON "TaxRate"("branchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_branchId_date_key" ON "Holiday"("branchId", "date");

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBranch" ADD CONSTRAINT "UserBranch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBranch" ADD CONSTRAINT "UserBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchSetting" ADD CONSTRAINT "BranchSetting_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

