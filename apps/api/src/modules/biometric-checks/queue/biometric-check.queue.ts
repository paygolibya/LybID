import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';

export const BIOMETRIC_CHECK_QUEUE_NAME = 'biometric-check';

export interface BiometricCheckJobData {
  biometricCheckId: string;
  tenantId: string;
  environment: 'LIVE' | 'TEST';
  // Optional — see UploadDocumentInput.apiKeyId's comment in documents.service.ts.
  apiKeyId?: string;
}

/** Thin producer wrapper — the enqueue side of async biometric processing, mirrors ExtractionQueue. */
@Injectable()
export class BiometricCheckQueue {
  private readonly logger = new Logger(BiometricCheckQueue.name);

  constructor(
    @InjectQueue(BIOMETRIC_CHECK_QUEUE_NAME)
    private readonly queue: Queue<BiometricCheckJobData>,
  ) {}

  async enqueue(data: BiometricCheckJobData): Promise<void> {
    const job = await this.queue.add('verify', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      // Same Postgres-commit-vs-Redis-visibility race as ExtractionQueue —
      // this is called from inside the request's transaction, Redis has no
      // knowledge of its commit boundary. See extraction.queue.ts's doc
      // comment for the full explanation; paired with a short retry in
      // BiometricChecksService.markProcessing for the same reason.
      delay: 250,
    });
    this.logger.log(
      `Enqueued biometric-check job ${job.id} for check ${data.biometricCheckId}`,
    );
  }
}
