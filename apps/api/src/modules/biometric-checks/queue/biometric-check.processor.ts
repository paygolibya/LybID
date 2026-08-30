import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, NotFoundException } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../../database/prisma.service';
import type { RequestAuthContext } from '../../../database/tenant-context';
import { StorageService } from '../../documents/storage/storage.service';
import { BiometricChecksService } from '../biometric-checks.service';
import { BiometricsClientService } from '../biometrics-client/biometrics-client.service';
import {
  BIOMETRIC_CHECK_QUEUE_NAME,
  BiometricCheckJobData,
} from './biometric-check.queue';

@Processor(BIOMETRIC_CHECK_QUEUE_NAME)
export class BiometricCheckProcessor extends WorkerHost {
  private readonly logger = new Logger(BiometricCheckProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly biometricChecksService: BiometricChecksService,
    private readonly biometricsClient: BiometricsClientService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<BiometricCheckJobData>): Promise<void> {
    const { biometricCheckId, tenantId, environment, apiKeyId } = job.data;
    const auth: Extract<RequestAuthContext, { mode: 'tenant' }> = {
      mode: 'tenant',
      tenantId,
      environment,
      apiKeyId,
    };

    // Short transaction #1: read the check + both related Document rows.
    // Their ownership/type were already validated at create() time — the
    // processor trusts the FK references, no re-validation needed here.
    const { selfieDocument, referenceDocument } = await this.prisma.runAsTenant(
      auth,
      async (tx) => {
        const check =
          await this.biometricChecksService.getForProcessing(biometricCheckId);
        const [selfie, reference] = await Promise.all([
          tx.document.findUnique({ where: { id: check.selfieDocumentId } }),
          tx.document.findUnique({ where: { id: check.referenceDocumentId } }),
        ]);
        if (!selfie || !reference) {
          throw new NotFoundException(
            `Selfie or reference document missing for biometric check ${biometricCheckId}`,
          );
        }
        return { selfieDocument: selfie, referenceDocument: reference };
      },
    );

    try {
      // Deliberately outside any transaction — see documents.service.ts's
      // markProcessing doc comment for why (Prisma's 5s interactive-
      // transaction timeout, and holding a DB transaction across a
      // multi-second external HTTP call is a hazard independent of that
      // timeout anyway).
      const [referenceBuffer, selfieBuffer] = await Promise.all([
        this.storage.getObject(referenceDocument.storageKey),
        this.storage.getObject(selfieDocument.storageKey),
      ]);
      const result = await this.biometricsClient.verify(
        referenceBuffer,
        referenceDocument.mimeType,
        referenceDocument.originalFilename,
        selfieBuffer,
        selfieDocument.mimeType,
        selfieDocument.originalFilename,
      );

      // Short transaction #2: write the result + terminal status.
      await this.prisma.runAsTenant(auth, () =>
        this.biometricChecksService.recordResult(biometricCheckId, result),
      );
    } catch (error) {
      this.logger.error(
        `Biometric check failed for ${biometricCheckId}: ${String(error)}`,
      );
      await this.prisma.runAsTenant(auth, () =>
        this.biometricChecksService.recordFailure(biometricCheckId),
      );
      throw error; // rethrow so BullMQ counts this attempt as failed and retries per the queue's backoff config
    }
  }
}
