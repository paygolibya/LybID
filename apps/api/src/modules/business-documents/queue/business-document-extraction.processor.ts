import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../../database/prisma.service';
import type { RequestAuthContext } from '../../../database/tenant-context';
import { OcrClientService } from '../../documents/ocr-client/ocr-client.service';
import { StorageService } from '../../documents/storage/storage.service';
import { BusinessDocumentsService } from '../business-documents.service';
import {
  BUSINESS_DOCUMENT_EXTRACTION_QUEUE_NAME,
  BusinessDocumentExtractionJobData,
} from './business-document-extraction.queue';

/**
 * Mirrors documents/queue/extraction.processor.ts's 3-short-transaction
 * pattern exactly (mark PROCESSING -> external OCR call outside any
 * transaction -> record result/failure) — same reasoning, own queue/table.
 */
@Processor(BUSINESS_DOCUMENT_EXTRACTION_QUEUE_NAME)
export class BusinessDocumentExtractionProcessor extends WorkerHost {
  private readonly logger = new Logger(
    BusinessDocumentExtractionProcessor.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly businessDocumentsService: BusinessDocumentsService,
    private readonly ocrClient: OcrClientService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<BusinessDocumentExtractionJobData>): Promise<void> {
    const { documentId, tenantId, environment, apiKeyId } = job.data;
    const auth: Extract<RequestAuthContext, { mode: 'tenant' }> = {
      mode: 'tenant',
      tenantId,
      environment,
      apiKeyId,
    };

    // Short transaction #1: UPLOADED -> PROCESSING, read what's needed for OCR.
    const document = await this.prisma.runAsTenant(auth, () =>
      this.businessDocumentsService.markProcessing(documentId),
    );

    try {
      // Deliberately outside any transaction — see markProcessing's doc comment.
      const buffer = await this.storage.getObject(document.storageKey);
      const result = await this.ocrClient.extract(
        document.type,
        buffer,
        document.mimeType,
        document.originalFilename,
      );

      // Short transaction #2: write the extraction + terminal status.
      await this.prisma.runAsTenant(auth, () =>
        this.businessDocumentsService.recordExtractionResult(
          documentId,
          result,
        ),
      );
    } catch (error) {
      this.logger.error(
        `Extraction failed for business document ${documentId}: ${String(error)}`,
      );
      await this.prisma.runAsTenant(auth, () =>
        this.businessDocumentsService.recordExtractionFailure(documentId),
      );
      throw error; // rethrow so BullMQ counts this attempt as failed and retries per the queue's backoff config
    }
  }
}
