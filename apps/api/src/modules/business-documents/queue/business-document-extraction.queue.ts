import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';

export const BUSINESS_DOCUMENT_EXTRACTION_QUEUE_NAME =
  'business-document-extraction';

export interface BusinessDocumentExtractionJobData {
  documentId: string;
  tenantId: string;
  environment: 'LIVE' | 'TEST';
  apiKeyId: string;
}

/**
 * Thin producer wrapper — mirrors documents/queue/extraction.queue.ts
 * exactly, on its own queue name so business-document jobs never mix with
 * applicant-document jobs.
 */
@Injectable()
export class BusinessDocumentExtractionQueue {
  private readonly logger = new Logger(BusinessDocumentExtractionQueue.name);

  constructor(
    @InjectQueue(BUSINESS_DOCUMENT_EXTRACTION_QUEUE_NAME)
    private readonly queue: Queue<BusinessDocumentExtractionJobData>,
  ) {}

  async enqueue(data: BusinessDocumentExtractionJobData): Promise<void> {
    const job = await this.queue.add('extract', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      // Same Postgres-commit-vs-Redis-visibility race as
      // extraction.queue.ts — this is called from inside the request's
      // transaction, so the worker needs a short delay before it can
      // reliably find the row. See that file's doc comment for the full
      // explanation; paired with the retry in
      // BusinessDocumentsService.markProcessing.
      delay: 250,
    });
    this.logger.log(
      `Enqueued business document extraction job ${job.id} for document ${data.documentId}`,
    );
  }
}
