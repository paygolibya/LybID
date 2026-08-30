import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';

export const EXTRACTION_QUEUE_NAME = 'document-extraction';

export interface ExtractionJobData {
  documentId: string;
  tenantId: string;
  environment: 'LIVE' | 'TEST';
  apiKeyId: string;
}

/** Thin producer wrapper — the enqueue side of async OCR processing. */
@Injectable()
export class ExtractionQueue {
  private readonly logger = new Logger(ExtractionQueue.name);

  constructor(
    @InjectQueue(EXTRACTION_QUEUE_NAME)
    private readonly queue: Queue<ExtractionJobData>,
  ) {}

  async enqueue(data: ExtractionJobData): Promise<void> {
    const job = await this.queue.add('extract', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      // This is called from inside the request's Postgres transaction
      // (DocumentsService.upload), but Redis has no knowledge of that
      // transaction's commit boundary — without a delay, the Worker can
      // start processing (and fail to find the Document row) before the
      // transaction that creates it has actually committed. A short delay
      // is a pragmatic guard, not a full fix for the general problem
      // (correctly would be a transactional-outbox pattern); it's paired
      // with a short retry in DocumentsService.markProcessing for the same
      // reason. See that method's doc comment.
      delay: 250,
    });
    this.logger.log(
      `Enqueued extraction job ${job.id} for document ${data.documentId}`,
    );
  }
}
