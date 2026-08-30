-- CreateEnum
CREATE TYPE "BiometricCheckStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "LivenessVerdict" AS ENUM ('LIVE', 'SPOOF', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "FaceMatchVerdict" AS ENUM ('MATCH', 'NO_MATCH', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'SELFIE';

-- CreateTable
CREATE TABLE "biometric_checks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "environment" "ApiKeyEnvironment" NOT NULL,
    "selfieDocumentId" TEXT NOT NULL,
    "referenceDocumentId" TEXT NOT NULL,
    "status" "BiometricCheckStatus" NOT NULL DEFAULT 'PROCESSING',
    "livenessScore" DOUBLE PRECISION,
    "livenessVerdict" "LivenessVerdict",
    "faceMatchScore" DOUBLE PRECISION,
    "faceMatchVerdict" "FaceMatchVerdict",
    "engine" TEXT,
    "rawResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "biometric_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "biometric_checks_tenantId_idx" ON "biometric_checks"("tenantId");

-- CreateIndex
CREATE INDEX "biometric_checks_applicantId_idx" ON "biometric_checks"("applicantId");

-- AddForeignKey
ALTER TABLE "biometric_checks" ADD CONSTRAINT "biometric_checks_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "applicants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_checks" ADD CONSTRAINT "biometric_checks_selfieDocumentId_fkey" FOREIGN KEY ("selfieDocumentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_checks" ADD CONSTRAINT "biometric_checks_referenceDocumentId_fkey" FOREIGN KEY ("referenceDocumentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
