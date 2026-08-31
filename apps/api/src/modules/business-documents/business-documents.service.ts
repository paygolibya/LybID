import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  BusinessDocument,
  BusinessDocumentType,
  Prisma,
} from '@prisma/client';
import { RequestContextService } from '../../database/tenant-context';
import { BusinessesService } from '../businesses/businesses.service';
import type { OcrExtractionResult } from '../documents/ocr-client/ocr-client.service';
import { UsageService } from '../usage/usage.service';
import type { ValidatedBusinessFile } from './business-file-validation.util';
import { BusinessDocumentExtractionQueue } from './queue/business-document-extraction.queue';
import { StorageService } from '../documents/storage/storage.service';

// Below this, a document is flagged for human review instead of trusted
// outright — same threshold and reasoning as documents.service.ts's
// NEEDS_REVIEW_CONFIDENCE_THRESHOLD (tunable, not derived from real-world
// data yet).
const NEEDS_REVIEW_CONFIDENCE_THRESHOLD = 0.75;

// Explicit allow-list, not "every type" implicitly — mirrors
// documents.service.ts's OCR_DOCUMENT_TYPES discipline exactly. All three
// current KYB document types need OCR today, but keeping this as an
// explicit set (rather than unconditionally enqueueing for every
// BusinessDocumentType) protects against a future type silently opting
// into OCR by default.
const KYB_OCR_DOCUMENT_TYPES: ReadonlySet<BusinessDocumentType> = new Set([
  'COMMERCIAL_REGISTRATION',
  'CHAMBER_OF_COMMERCE',
  'TAX_ID',
]);

export interface UploadBusinessDocumentInput {
  businessId: string;
  type: BusinessDocumentType;
  buffer: Buffer;
  originalFilename: string;
  validated: ValidatedBusinessFile;
  apiKeyId: string;
}

@Injectable()
export class BusinessDocumentsService {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly businessesService: BusinessesService,
    private readonly storage: StorageService,
    private readonly extractionQueue: BusinessDocumentExtractionQueue,
    private readonly usage: UsageService,
  ) {}

  async upload(input: UploadBusinessDocumentInput): Promise<BusinessDocument> {
    const tx = this.requestContext.requireTx();

    // Resolving through the (extension-scoped) BusinessesService is what
    // prevents cross-tenant FK smuggling — a cross-tenant businessId throws
    // NotFoundException here, before any BusinessDocument row is created.
    const business = await this.businessesService.getOrThrow(input.businessId);

    const document = await tx.businessDocument.create({
      data: {
        businessId: business.id,
        type: input.type,
        status: 'UPLOADED',
        storageKey: '', // set below, after we know the document id
        originalFilename: input.originalFilename,
        mimeType: input.validated.mimeType,
        fileSizeBytes: input.buffer.length,
        sha256: input.validated.sha256,
      } as Prisma.BusinessDocumentUncheckedCreateInput,
    });

    const storageKey = this.storage.buildKey(
      document.tenantId,
      document.id,
      input.originalFilename,
    );
    await this.storage.putObject(
      storageKey,
      input.buffer,
      input.validated.mimeType,
    );
    const updated = await tx.businessDocument.update({
      where: { id: document.id },
      data: { storageKey },
    });

    if (KYB_OCR_DOCUMENT_TYPES.has(input.type)) {
      await this.extractionQueue.enqueue({
        documentId: updated.id,
        tenantId: updated.tenantId,
        environment: updated.environment,
        apiKeyId: input.apiKeyId,
      });
    }

    return updated;
  }

  async getWithLatestExtraction(id: string) {
    const tx = this.requestContext.requireTx();
    const document = await tx.businessDocument.findUnique({ where: { id } });
    if (!document) {
      throw new NotFoundException(`Business document ${id} not found`);
    }
    const latestExtraction = await tx.businessDocumentExtraction.findFirst({
      where: { documentId: id },
      orderBy: { createdAt: 'desc' },
    });
    return { ...document, latestExtraction };
  }

  /**
   * Flips UPLOADED -> PROCESSING and returns the document, in its own short
   * transaction — mirrors documents.service.ts's markProcessing exactly,
   * including the same retry-against-commit-latency reasoning. See that
   * method's doc comment for the full explanation.
   */
  async markProcessing(documentId: string): Promise<BusinessDocument> {
    const tx = this.requestContext.requireTx();
    const document = await this.findDocumentWithRetry(documentId);
    if (!document) {
      throw new NotFoundException(`Business document ${documentId} not found`);
    }
    return tx.businessDocument.update({
      where: { id: documentId },
      data: { status: 'PROCESSING' },
    });
  }

  private async findDocumentWithRetry(
    documentId: string,
    attempts = 5,
    delayMs = 100,
  ): Promise<BusinessDocument | null> {
    const tx = this.requestContext.requireTx();
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const document = await tx.businessDocument.findUnique({
        where: { id: documentId },
      });
      if (document) return document;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return null;
  }

  async recordExtractionResult(
    documentId: string,
    result: OcrExtractionResult,
  ): Promise<void> {
    const tx = this.requestContext.requireTx();
    const document = await tx.businessDocument.findUnique({
      where: { id: documentId },
    });
    if (!document) {
      throw new NotFoundException(`Business document ${documentId} not found`);
    }

    await tx.businessDocumentExtraction.create({
      data: {
        documentId: document.id,
        engine: 'tesseract-5',
        rawText: result.rawText,
        fields: result.fields as unknown as Prisma.InputJsonValue,
        overallConfidence: result.overallConfidence,
        status: 'COMPLETED',
      } as Prisma.BusinessDocumentExtractionUncheckedCreateInput,
    });

    await tx.businessDocument.update({
      where: { id: document.id },
      data: {
        status:
          result.overallConfidence < NEEDS_REVIEW_CONFIDENCE_THRESHOLD
            ? 'NEEDS_REVIEW'
            : 'EXTRACTED',
        processedAt: new Date(),
      },
    });

    // Phase 5: mirrors documents.service.ts's recordExtractionResult
    // exactly — a real OCR outcome is billable, not attempted here for
    // recordExtractionFailure below (that's infrastructure failure, not
    // verification work done for the tenant).
    await this.usage.recordBusinessDocumentProcessed(document.id);
  }

  /** The error itself is logged by the caller (the BullMQ processor) — this just records the terminal state. */
  async recordExtractionFailure(documentId: string): Promise<void> {
    const tx = this.requestContext.requireTx();
    const document = await tx.businessDocument.findUnique({
      where: { id: documentId },
    });
    if (!document) {
      throw new NotFoundException(`Business document ${documentId} not found`);
    }

    await tx.businessDocumentExtraction.create({
      data: {
        documentId: document.id,
        engine: 'tesseract-5',
        status: 'FAILED',
      } as Prisma.BusinessDocumentExtractionUncheckedCreateInput,
    });

    await tx.businessDocument.update({
      where: { id: document.id },
      data: { status: 'FAILED', processedAt: new Date() },
    });
  }
}
