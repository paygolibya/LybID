-- CreateEnum
CREATE TYPE "UsageEventType" AS ENUM ('DOCUMENT_PROCESSED');

-- CreateTable
CREATE TABLE "usage_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "environment" "ApiKeyEnvironment" NOT NULL,
    "type" "UsageEventType" NOT NULL,
    "documentId" TEXT,
    "businessDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usage_records_tenantId_idx" ON "usage_records"("tenantId");

-- CreateIndex
CREATE INDEX "usage_records_createdAt_idx" ON "usage_records"("createdAt");

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_businessDocumentId_fkey" FOREIGN KEY ("businessDocumentId") REFERENCES "business_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
