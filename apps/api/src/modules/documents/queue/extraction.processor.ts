import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../../database/prisma.service';
import type { RequestAuthContext } from '../../../database/tenant-context';
import { DocumentsService } from '../documents.service';
import { OcrClientService } from '../ocr-client/ocr-client.service';
import { StorageService } from '../storage/storage.service';
import { EXTRACTION_QUEUE_NAME, ExtractionJobData } from './extraction.queue';

@Processor(EXTRACTION_QUEUE_NAME)
export class ExtractionProcessor extends WorkerHost {
  private readonly logger = new Logger(ExtractionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
    private readonly ocrClient: OcrClientService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<ExtractionJobData>): Promise<void> {
    const { documentId, tenantId, environment, apiKeyId } = job.data;
    const auth: Extract<RequestAuthContext, { mode: 'tenant' }> = {
      mode: 'tenant',
      tenantId,
      environment,
      apiKeyId,
    };

    // Short transaction #1: UPLOADED -> PROCESSING, read what's needed for OCR.
    const document = await this.prisma.runAsTenant(auth, () =>
      this.documentsService.markProcessing(documentId),
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
        this.documentsService.recordExtractionResult(documentId, result),
      );
    } catch (error) {
      this.logger.error(
        `Extraction failed for document ${documentId}: ${String(error)}`,
      );
      await this.prisma.runAsTenant(auth, () =>
        this.documentsService.recordExtractionFailure(documentId),
      );
      throw error; // rethrow so BullMQ counts this attempt as failed and retries per the queue's backoff config
    }
  }
}
