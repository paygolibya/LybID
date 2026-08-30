-- CreateEnum
CREATE TYPE "BusinessStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BusinessDocumentType" AS ENUM ('COMMERCIAL_REGISTRATION', 'CHAMBER_OF_COMMERCE', 'TAX_ID');

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "environment" "ApiKeyEnvironment" NOT NULL,
    "externalId" TEXT,
    "legalName" TEXT,
    "commercialRegistrationNumber" TEXT,
    "status" "BusinessStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "environment" "ApiKeyEnvironment" NOT NULL,
    "type" "BusinessDocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "business_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_document_extractions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "environment" "ApiKeyEnvironment" NOT NULL,
    "engine" TEXT NOT NULL,
    "rawText" TEXT,
    "fields" JSONB,
    "overallConfidence" DOUBLE PRECISION,
    "status" "ExtractionStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_document_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "businesses_tenantId_idx" ON "businesses"("tenantId");

-- CreateIndex
CREATE INDEX "business_documents_tenantId_idx" ON "business_documents"("tenantId");

-- CreateIndex
CREATE INDEX "business_documents_businessId_idx" ON "business_documents"("businessId");

-- CreateIndex
CREATE INDEX "business_documents_sha256_idx" ON "business_documents"("sha256");

-- CreateIndex
CREATE INDEX "business_document_extractions_tenantId_idx" ON "business_document_extractions"("tenantId");

-- CreateIndex
CREATE INDEX "business_document_extractions_documentId_idx" ON "business_document_extractions"("documentId");

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_documents" ADD CONSTRAINT "business_documents_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_document_extractions" ADD CONSTRAINT "business_document_extractions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "business_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
