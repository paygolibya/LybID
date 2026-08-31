-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('APPROVED', 'REJECTED', 'NEEDS_REVIEW');

-- AlterTable
ALTER TABLE "applicants" ADD COLUMN     "latestDecisionStatus" "DecisionStatus";

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "latestDecisionStatus" "DecisionStatus";

-- CreateTable
CREATE TABLE "applicant_decisions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "environment" "ApiKeyEnvironment" NOT NULL,
    "status" "DecisionStatus" NOT NULL,
    "reasoning" JSONB NOT NULL,
    "reviewerId" TEXT,
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applicant_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_decisions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "environment" "ApiKeyEnvironment" NOT NULL,
    "status" "DecisionStatus" NOT NULL,
    "reasoning" JSONB NOT NULL,
    "reviewerId" TEXT,
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "applicant_decisions_tenantId_idx" ON "applicant_decisions"("tenantId");

-- CreateIndex
CREATE INDEX "applicant_decisions_applicantId_idx" ON "applicant_decisions"("applicantId");

-- CreateIndex
CREATE INDEX "business_decisions_tenantId_idx" ON "business_decisions"("tenantId");

-- CreateIndex
CREATE INDEX "business_decisions_businessId_idx" ON "business_decisions"("businessId");

-- AddForeignKey
ALTER TABLE "applicant_decisions" ADD CONSTRAINT "applicant_decisions_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "applicants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_decisions" ADD CONSTRAINT "business_decisions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
