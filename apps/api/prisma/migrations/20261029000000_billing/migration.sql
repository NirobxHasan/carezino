-- CreateEnum
CREATE TYPE "BillableServiceCategory" AS ENUM ('ASSESSMENT', 'THERAPY_SESSION', 'OTHER');

-- CreateEnum
CREATE TYPE "AssessmentBillingPolicy" AS ENUM ('ON_BOOKING', 'MANUAL');

-- CreateEnum
CREATE TYPE "SessionBillingPolicy" AS ENUM ('ON_COMPLETION', 'MANUAL');

-- CreateEnum
CREATE TYPE "PackageBillingPolicy" AS ENUM ('ON_ENROLLMENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "InvoiceItemKind" AS ENUM ('PACKAGE', 'ASSESSMENT_FEE', 'SESSION_FEE', 'ADDITIONAL_FEE', 'OTHER');

-- CreateEnum
CREATE TYPE "BillingDiscountType" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('RECORDED', 'REVERSED');

-- CreateEnum
CREATE TYPE "AllocationReleaseReason" AS ENUM ('REALLOCATED', 'INVOICE_VOIDED', 'PAYMENT_REVERSED');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('RECORDED', 'VOID');

-- CreateTable
CREATE TABLE "CenterBillingSettings" (
    "centerId" UUID NOT NULL,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV-',
    "receiptPrefix" TEXT NOT NULL DEFAULT 'RCP-',
    "defaultDueDays" INTEGER NOT NULL DEFAULT 7,
    "allowPartialPayment" BOOLEAN NOT NULL DEFAULT true,
    "allowAdvancePayment" BOOLEAN NOT NULL DEFAULT true,
    "allowManualDiscount" BOOLEAN NOT NULL DEFAULT true,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxLabel" TEXT NOT NULL DEFAULT 'VAT',
    "assessmentBillingPolicy" "AssessmentBillingPolicy" NOT NULL DEFAULT 'MANUAL',
    "sessionBillingPolicy" "SessionBillingPolicy" NOT NULL DEFAULT 'MANUAL',
    "packageBillingPolicy" "PackageBillingPolicy" NOT NULL DEFAULT 'MANUAL',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CenterBillingSettings_pkey" PRIMARY KEY ("centerId")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "requiresReference" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillableService" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "BillableServiceCategory" NOT NULL,
    "therapyTypeId" UUID,
    "price" DECIMAL(12,2) NOT NULL,
    "defaultDurationMinutes" INTEGER,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillableService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "number" TEXT,
    "patientId" UUID NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE,
    "currency" TEXT NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "invoiceDiscountType" "BillingDiscountType",
    "invoiceDiscountValue" DECIMAL(12,2),
    "invoiceDiscountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxLabel" TEXT,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "reissuedFromId" UUID,
    "requestId" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "updatedById" UUID,
    "issuedAt" TIMESTAMP(3),
    "issuedById" UUID,
    "voidedAt" TIMESTAMP(3),
    "voidedById" UUID,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "InvoiceItemKind" NOT NULL,
    "description" TEXT NOT NULL,
    "serviceId" UUID,
    "appointmentId" UUID,
    "packageEnrollmentId" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "discountType" "BillingDiscountType",
    "discountValue" DECIMAL(12,2),
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "patientId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "methodId" UUID NOT NULL,
    "transactionReference" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "collectedById" UUID NOT NULL,
    "notes" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'RECORDED',
    "allocatedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reversedAt" TIMESTAMP(3),
    "reversedById" UUID,
    "reversalReason" TEXT,
    "requestId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "requestId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedById" UUID,
    "releaseReason" "AllocationReleaseReason",
    "releaseNote" TEXT,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "methodId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT,
    "refundedAt" TIMESTAMP(3) NOT NULL,
    "approvedById" UUID NOT NULL,
    "requestId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "expenseDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "methodId" UUID NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'RECORDED',
    "requestId" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "updatedById" UUID,
    "voidedAt" TIMESTAMP(3),
    "voidedById" UUID,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseRevision" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "expenseId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "changed" JSONB NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentMethod_centerId_isActive_displayOrder_idx" ON "PaymentMethod"("centerId", "isActive", "displayOrder");

-- CreateIndex
CREATE INDEX "BillableService_centerId_category_isActive_idx" ON "BillableService"("centerId", "category", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BillableService_centerId_code_key" ON "BillableService"("centerId", "code");

-- CreateIndex
CREATE INDEX "Invoice_centerId_status_dueDate_idx" ON "Invoice"("centerId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "Invoice_centerId_invoiceDate_idx" ON "Invoice"("centerId", "invoiceDate");

-- CreateIndex
CREATE INDEX "Invoice_patientId_createdAt_idx" ON "Invoice"("patientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_centerId_number_key" ON "Invoice"("centerId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_centerId_requestId_key" ON "Invoice"("centerId", "requestId");

-- CreateIndex
CREATE INDEX "InvoiceItem_appointmentId_idx" ON "InvoiceItem"("appointmentId");

-- CreateIndex
CREATE INDEX "InvoiceItem_packageEnrollmentId_idx" ON "InvoiceItem"("packageEnrollmentId");

-- CreateIndex
CREATE INDEX "InvoiceItem_serviceId_idx" ON "InvoiceItem"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceItem_invoiceId_position_key" ON "InvoiceItem"("invoiceId", "position");

-- CreateIndex
CREATE INDEX "Payment_centerId_collectedAt_idx" ON "Payment"("centerId", "collectedAt");

-- CreateIndex
CREATE INDEX "Payment_patientId_collectedAt_idx" ON "Payment"("patientId", "collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_centerId_number_key" ON "Payment"("centerId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_centerId_requestId_key" ON "Payment"("centerId", "requestId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_invoiceId_idx" ON "PaymentAllocation"("invoiceId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_centerId_requestId_idx" ON "PaymentAllocation"("centerId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_paymentId_requestId_key" ON "PaymentAllocation"("paymentId", "requestId");

-- CreateIndex
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");

-- CreateIndex
CREATE INDEX "Refund_centerId_refundedAt_idx" ON "Refund"("centerId", "refundedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_centerId_requestId_key" ON "Refund"("centerId", "requestId");

-- CreateIndex
CREATE INDEX "ExpenseCategory_centerId_isActive_displayOrder_idx" ON "ExpenseCategory"("centerId", "isActive", "displayOrder");

-- CreateIndex
CREATE INDEX "Expense_centerId_expenseDate_idx" ON "Expense"("centerId", "expenseDate");

-- CreateIndex
CREATE INDEX "Expense_centerId_status_expenseDate_idx" ON "Expense"("centerId", "status", "expenseDate");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_centerId_requestId_key" ON "Expense"("centerId", "requestId");

-- CreateIndex
CREATE INDEX "ExpenseRevision_expenseId_createdAt_idx" ON "ExpenseRevision"("expenseId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_centerId_entityType_entityId_idx" ON "AuditLog"("centerId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "CenterBillingSettings" ADD CONSTRAINT "CenterBillingSettings_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillableService" ADD CONSTRAINT "BillableService_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillableService" ADD CONSTRAINT "BillableService_therapyTypeId_fkey" FOREIGN KEY ("therapyTypeId") REFERENCES "TherapyType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillableService" ADD CONSTRAINT "BillableService_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillableService" ADD CONSTRAINT "BillableService_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_reissuedFromId_fkey" FOREIGN KEY ("reissuedFromId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "BillableService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_packageEnrollmentId_fkey" FOREIGN KEY ("packageEnrollmentId") REFERENCES "PackageEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseRevision" ADD CONSTRAINT "ExpenseRevision_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseRevision" ADD CONSTRAINT "ExpenseRevision_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseRevision" ADD CONSTRAINT "ExpenseRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ── Rules Prisma can't express ──────────────────────────────────────────────

-- One live charge per operational event: a package enrollment is invoiced once, and an
-- appointment's assessment or session fee once, until the invoice holding it is voided
-- (which makes its lines inactive). Draft lines count, so a second invoice for the same
-- event is refused while the first is still being prepared. Additional fees (e.g. a
-- no-show fee) are deliberate extra charges and aren't limited.
CREATE UNIQUE INDEX "InvoiceItem_one_charge_per_enrollment" ON "InvoiceItem"("packageEnrollmentId") WHERE "kind" = 'PACKAGE' AND "active";
CREATE UNIQUE INDEX "InvoiceItem_one_fee_per_appointment" ON "InvoiceItem"("appointmentId") WHERE "kind" IN ('ASSESSMENT_FEE', 'SESSION_FEE') AND "active";

-- Names are unique per center, ignoring case.
CREATE UNIQUE INDEX "PaymentMethod_centerId_name_key" ON "PaymentMethod"("centerId", lower("name"));
CREATE UNIQUE INDEX "ExpenseCategory_centerId_name_key" ON "ExpenseCategory"("centerId", lower("name"));

ALTER TABLE "CenterBillingSettings" ADD CONSTRAINT "CenterBillingSettings_check" CHECK (
  "defaultDueDays" BETWEEN 0 AND 365
  AND "taxRate" >= 0 AND "taxRate" <= 100
  AND length("invoicePrefix") <= 10
  AND length("receiptPrefix") <= 10
  AND length(btrim("taxLabel")) > 0
);

ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_check" CHECK (length(btrim("name")) > 0);
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_check" CHECK (length(btrim("name")) > 0);

ALTER TABLE "BillableService" ADD CONSTRAINT "BillableService_check" CHECK (
  length(btrim("name")) > 0
  AND length(btrim("code")) > 0
  AND "code" = upper("code")
  AND "price" >= 0
  AND ("defaultDurationMinutes" IS NULL OR "defaultDurationMinutes" BETWEEN 5 AND 480)
);

-- The totals add up, discounts fit their type and never exceed what they discount.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_amounts_check" CHECK (
  "subtotal" >= 0
  AND "discountAmount" >= 0 AND "discountAmount" <= "subtotal"
  AND "invoiceDiscountAmount" >= 0 AND "invoiceDiscountAmount" <= "discountAmount"
  AND "taxRate" >= 0 AND "taxRate" <= 100
  AND "taxAmount" >= 0
  AND "totalAmount" = "subtotal" - "discountAmount" + "taxAmount"
  AND (("invoiceDiscountType" IS NULL) = ("invoiceDiscountValue" IS NULL))
  AND ("invoiceDiscountType" IS NOT NULL OR "invoiceDiscountAmount" = 0)
  AND ("invoiceDiscountType" IS DISTINCT FROM 'PERCENTAGE' OR ("invoiceDiscountValue" > 0 AND "invoiceDiscountValue" <= 100))
  AND ("invoiceDiscountType" IS DISTINCT FROM 'FIXED' OR "invoiceDiscountValue" > 0)
);
-- An invoice is never paid beyond its total. Checked on every allocation, so of two
-- concurrent payments for the same balance the second fails even if it slipped past
-- the service's own check. The status always matches what's paid.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_paid_check" CHECK (
  "paidAmount" >= 0
  AND "paidAmount" <= "totalAmount"
  AND ("status" NOT IN ('DRAFT', 'ISSUED', 'VOID') OR "paidAmount" = 0)
  AND ("status" <> 'PARTIALLY_PAID' OR ("paidAmount" > 0 AND "paidAmount" < "totalAmount"))
  AND ("status" <> 'PAID' OR "paidAmount" = "totalAmount")
);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_lifecycle_check" CHECK (
  (("status" = 'DRAFT') = ("number" IS NULL))
  AND (("status" = 'DRAFT') = ("issuedAt" IS NULL))
  AND (("issuedAt" IS NULL) = ("issuedById" IS NULL))
  AND (("status" = 'VOID') = ("voidedAt" IS NOT NULL))
  AND (("voidedAt" IS NULL) = ("voidedById" IS NULL))
  AND ("status" <> 'VOID' OR length(btrim("voidReason")) > 0)
  AND ("dueDate" IS NULL OR "dueDate" >= "invoiceDate")
);

-- Each kind of line points at what it charges for, and its arithmetic adds up.
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_check" CHECK (
  length(btrim("description")) > 0
  AND "quantity" BETWEEN 1 AND 1000
  AND "unitPrice" >= 0
  AND "amount" = "quantity" * "unitPrice"
  AND "discountAmount" >= 0 AND "discountAmount" <= "amount"
  AND "totalAmount" = "amount" - "discountAmount"
  AND (("discountType" IS NULL) = ("discountValue" IS NULL))
  AND ("discountType" IS NOT NULL OR "discountAmount" = 0)
  AND ("discountType" IS DISTINCT FROM 'PERCENTAGE' OR ("discountValue" > 0 AND "discountValue" <= 100))
  AND ("discountType" IS DISTINCT FROM 'FIXED' OR "discountValue" > 0)
  AND CASE "kind"
    WHEN 'PACKAGE' THEN "packageEnrollmentId" IS NOT NULL AND "appointmentId" IS NULL AND "quantity" = 1
    WHEN 'ASSESSMENT_FEE' THEN "appointmentId" IS NOT NULL AND "packageEnrollmentId" IS NULL AND "quantity" = 1
    WHEN 'SESSION_FEE' THEN "appointmentId" IS NOT NULL AND "packageEnrollmentId" IS NULL AND "quantity" = 1
    WHEN 'ADDITIONAL_FEE' THEN "appointmentId" IS NOT NULL AND "packageEnrollmentId" IS NULL
    WHEN 'OTHER' THEN "appointmentId" IS NULL AND "packageEnrollmentId" IS NULL
  END
);

-- A payment's allocations and refunds never exceed it, so credit can't be spent twice
-- or refunded after it was applied. A reversed payment counts for nothing.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_balance_check" CHECK (
  "amount" > 0
  AND "allocatedAmount" >= 0
  AND "refundedAmount" >= 0
  AND "allocatedAmount" + "refundedAmount" <= "amount"
);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_lifecycle_check" CHECK (
  (("status" = 'REVERSED') = ("reversedAt" IS NOT NULL))
  AND (("reversedAt" IS NULL) = ("reversedById" IS NULL))
  AND ("status" <> 'REVERSED' OR (length(btrim("reversalReason")) > 0 AND "allocatedAmount" = 0 AND "refundedAmount" = 0))
);

ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_check" CHECK (
  "amount" > 0
  AND (("releasedAt" IS NULL) = ("releaseReason" IS NULL))
  AND (("releasedAt" IS NULL) = ("releasedById" IS NULL))
);

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_check" CHECK (
  "amount" > 0 AND length(btrim("reason")) > 0
);

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_check" CHECK (
  "amount" > 0
  AND length(btrim("description")) > 0
  AND (("status" = 'VOID') = ("voidedAt" IS NOT NULL))
  AND (("voidedAt" IS NULL) = ("voidedById" IS NULL))
  AND ("status" <> 'VOID' OR length(btrim("voidReason")) > 0)
);

-- Invoices: a draft may change freely and be deleted; from issue on, the commercial
-- terms are fixed, the only changes being its status and paid amount (from
-- allocations) and voiding, which is final. Voiding makes its lines inactive.
CREATE FUNCTION "billing_invoice_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Issued invoices cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."centerId" <> OLD."centerId" OR NEW."createdById" <> OLD."createdById"
     OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'An invoice''s center and creator cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'VOID' THEN
    RAISE EXCEPTION 'A void invoice cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" <> 'DRAFT' THEN
    IF NEW."status" = 'DRAFT'
       OR NEW."number" IS DISTINCT FROM OLD."number" OR NEW."patientId" <> OLD."patientId"
       OR NEW."invoiceDate" <> OLD."invoiceDate" OR NEW."dueDate" IS DISTINCT FROM OLD."dueDate"
       OR NEW."currency" <> OLD."currency" OR NEW."subtotal" <> OLD."subtotal"
       OR NEW."discountAmount" <> OLD."discountAmount"
       OR NEW."invoiceDiscountType" IS DISTINCT FROM OLD."invoiceDiscountType"
       OR NEW."invoiceDiscountValue" IS DISTINCT FROM OLD."invoiceDiscountValue"
       OR NEW."invoiceDiscountAmount" <> OLD."invoiceDiscountAmount"
       OR NEW."taxRate" <> OLD."taxRate" OR NEW."taxLabel" IS DISTINCT FROM OLD."taxLabel"
       OR NEW."taxAmount" <> OLD."taxAmount" OR NEW."totalAmount" <> OLD."totalAmount"
       OR NEW."notes" IS DISTINCT FROM OLD."notes" OR NEW."automatic" <> OLD."automatic"
       OR NEW."reissuedFromId" IS DISTINCT FROM OLD."reissuedFromId"
       OR NEW."requestId" IS DISTINCT FROM OLD."requestId"
       OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt"
       OR NEW."issuedById" IS DISTINCT FROM OLD."issuedById" THEN
      RAISE EXCEPTION 'An issued invoice''s terms cannot change' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Invoice_guard"
  BEFORE UPDATE OR DELETE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION "billing_invoice_guard"();

CREATE FUNCTION "billing_invoice_voided"() RETURNS trigger AS $$
BEGIN
  UPDATE "InvoiceItem" SET "active" = false WHERE "invoiceId" = NEW."id" AND "active";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Invoice_voided"
  AFTER UPDATE OF "status" ON "Invoice"
  FOR EACH ROW WHEN (NEW."status" = 'VOID' AND OLD."status" <> 'VOID')
  EXECUTE FUNCTION "billing_invoice_voided"();

-- Lines are written while their invoice is a draft (and deleted with it), are for its
-- own patient's appointments and enrollments, and never change once issued, except
-- becoming inactive when it's voided.
CREATE FUNCTION "billing_invoice_item_guard"() RETURNS trigger AS $$
DECLARE
  inv RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT "status" INTO inv FROM "Invoice" WHERE "id" = OLD."invoiceId";
    IF FOUND AND inv."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Lines of an issued invoice cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  SELECT "status", "centerId", "patientId" INTO inv FROM "Invoice" WHERE "id" = NEW."invoiceId";
  IF TG_OP = 'UPDATE' THEN
    IF NEW."active" = false AND OLD."active" AND inv."status" = 'VOID'
       AND (to_jsonb(NEW) - 'active') = (to_jsonb(OLD) - 'active') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Invoice lines cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF inv."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Lines can only be added to a draft invoice' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."centerId" <> inv."centerId" OR NOT NEW."active" THEN
    RAISE EXCEPTION 'An invoice line belongs to its invoice''s center' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."appointmentId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Appointment" a WHERE a."id" = NEW."appointmentId"
      AND a."centerId" = inv."centerId" AND a."patientId" = inv."patientId") THEN
    RAISE EXCEPTION 'An invoice line can only charge for the invoice patient''s appointments' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."packageEnrollmentId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "PackageEnrollment" e WHERE e."id" = NEW."packageEnrollmentId"
      AND e."centerId" = inv."centerId" AND e."patientId" = inv."patientId") THEN
    RAISE EXCEPTION 'An invoice line can only charge for the invoice patient''s packages' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."serviceId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "BillableService" s WHERE s."id" = NEW."serviceId" AND s."centerId" = inv."centerId") THEN
    RAISE EXCEPTION 'An invoice line can only use its center''s services' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InvoiceItem_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceItem"
  FOR EACH ROW EXECUTE FUNCTION "billing_invoice_item_guard"();

-- Payments are never deleted, and what was received never changes. The only change is
-- a reversal, once; the allocated and refunded amounts follow their rows (triggers below).
CREATE FUNCTION "billing_payment_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payments cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."centerId" <> OLD."centerId" OR NEW."number" <> OLD."number"
     OR NEW."patientId" <> OLD."patientId" OR NEW."amount" <> OLD."amount"
     OR NEW."currency" <> OLD."currency" OR NEW."methodId" <> OLD."methodId"
     OR NEW."transactionReference" IS DISTINCT FROM OLD."transactionReference"
     OR NEW."collectedAt" <> OLD."collectedAt" OR NEW."collectedById" <> OLD."collectedById"
     OR NEW."notes" IS DISTINCT FROM OLD."notes"
     OR NEW."requestId" IS DISTINCT FROM OLD."requestId" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'A recorded payment cannot be edited' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'REVERSED' AND (NEW."status" <> 'REVERSED'
     OR NEW."reversedAt" IS DISTINCT FROM OLD."reversedAt"
     OR NEW."reversedById" IS DISTINCT FROM OLD."reversedById"
     OR NEW."reversalReason" IS DISTINCT FROM OLD."reversalReason") THEN
    RAISE EXCEPTION 'A reversed payment cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Payment_guard"
  BEFORE UPDATE OR DELETE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION "billing_payment_guard"();

-- Allocations apply a recorded payment to an open invoice of the same patient and
-- center. They're never deleted or edited, only released once.
CREATE FUNCTION "billing_allocation_guard"() RETURNS trigger AS $$
DECLARE
  pay RECORD;
  inv RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment allocations cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."releasedAt" IS NULL AND NEW."releasedAt" IS NOT NULL
       AND NEW."paymentId" = OLD."paymentId" AND NEW."invoiceId" = OLD."invoiceId"
       AND NEW."amount" = OLD."amount" AND NEW."centerId" = OLD."centerId"
       AND NEW."createdAt" = OLD."createdAt" AND NEW."createdById" = OLD."createdById"
       AND NEW."requestId" IS NOT DISTINCT FROM OLD."requestId" THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'A payment allocation can only be released, once' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."releasedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'A payment allocation starts active' USING ERRCODE = 'check_violation';
  END IF;
  SELECT "centerId", "patientId", "status" INTO pay FROM "Payment" WHERE "id" = NEW."paymentId";
  SELECT "centerId", "patientId", "status" INTO inv FROM "Invoice" WHERE "id" = NEW."invoiceId";
  IF pay."centerId" <> NEW."centerId" OR inv."centerId" <> NEW."centerId"
     OR pay."patientId" <> inv."patientId" THEN
    RAISE EXCEPTION 'A payment can only be applied to its own patient''s invoices' USING ERRCODE = 'check_violation';
  END IF;
  IF pay."status" <> 'RECORDED' THEN
    RAISE EXCEPTION 'A reversed payment cannot be applied' USING ERRCODE = 'check_violation';
  END IF;
  IF inv."status" NOT IN ('ISSUED', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'Payments can only be applied to issued, unpaid invoices' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentAllocation_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "PaymentAllocation"
  FOR EACH ROW EXECUTE FUNCTION "billing_allocation_guard"();

-- The payment's allocated amount and the invoice's paid amount and status follow the
-- active allocations.
CREATE FUNCTION "billing_allocation_apply"() RETURNS trigger AS $$
DECLARE
  delta numeric(12, 2);
BEGIN
  IF TG_OP = 'INSERT' THEN
    delta := NEW."amount";
  ELSE
    delta := -OLD."amount";
  END IF;
  UPDATE "Payment" SET "allocatedAmount" = "allocatedAmount" + delta WHERE "id" = NEW."paymentId";
  UPDATE "Invoice" SET
    "paidAmount" = "paidAmount" + delta,
    "status" = (CASE
      WHEN "paidAmount" + delta = 0 THEN 'ISSUED'
      WHEN "paidAmount" + delta >= "totalAmount" THEN 'PAID'
      ELSE 'PARTIALLY_PAID'
    END)::"InvoiceStatus"
  WHERE "id" = NEW."invoiceId";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentAllocation_apply"
  AFTER INSERT OR UPDATE ON "PaymentAllocation"
  FOR EACH ROW EXECUTE FUNCTION "billing_allocation_apply"();

-- Refunds are append-only, come from a recorded payment of the same center, and add to
-- its refunded amount.
CREATE FUNCTION "billing_refund_guard"() RETURNS trigger AS $$
DECLARE
  pay RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Refunds cannot be changed or deleted' USING ERRCODE = 'check_violation';
  END IF;
  SELECT "centerId", "status" INTO pay FROM "Payment" WHERE "id" = NEW."paymentId";
  IF pay."centerId" <> NEW."centerId" OR pay."status" <> 'RECORDED' THEN
    RAISE EXCEPTION 'Refunds come from a recorded payment of the same center' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Refund_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "Refund"
  FOR EACH ROW EXECUTE FUNCTION "billing_refund_guard"();

CREATE FUNCTION "billing_refund_apply"() RETURNS trigger AS $$
BEGIN
  UPDATE "Payment" SET "refundedAmount" = "refundedAmount" + NEW."amount" WHERE "id" = NEW."paymentId";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Refund_apply"
  AFTER INSERT ON "Refund"
  FOR EACH ROW EXECUTE FUNCTION "billing_refund_apply"();

-- Expenses are never deleted; corrections keep their history and voiding is final.
CREATE FUNCTION "billing_expense_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Expenses cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'VOID' THEN
    RAISE EXCEPTION 'A void expense cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."centerId" <> OLD."centerId" OR NEW."createdById" <> OLD."createdById"
     OR NEW."createdAt" <> OLD."createdAt" OR NEW."requestId" IS DISTINCT FROM OLD."requestId" THEN
    RAISE EXCEPTION 'An expense''s center and author cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Expense_guard"
  BEFORE UPDATE OR DELETE ON "Expense"
  FOR EACH ROW EXECUTE FUNCTION "billing_expense_guard"();

CREATE FUNCTION "billing_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be changed or deleted', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ExpenseRevision_append_only"
  BEFORE UPDATE OR DELETE ON "ExpenseRevision"
  FOR EACH ROW EXECUTE FUNCTION "billing_append_only"();
