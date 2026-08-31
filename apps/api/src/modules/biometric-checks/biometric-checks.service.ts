import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { BiometricCheck, Document, Prisma } from '@prisma/client';
import { RequestContextService } from '../../database/tenant-context';
import { ApplicantsService } from '../applicants/applicants.service';
import type { BiometricVerifyResult } from './biometrics-client/biometrics-client.service';
import { BiometricCheckQueue } from './queue/biometric-check.queue';
import type { CreateBiometricCheckDto } from './dto/create-biometric-check.dto';

// Below this, a check is flagged for human review instead of trusted
// outright. Tunable — not derived from real-world data yet, same posture as
// documents.service.ts's NEEDS_REVIEW_CONFIDENCE_THRESHOLD.
const NEEDS_REVIEW_LIVENESS_THRESHOLD = 0.7;
const NEEDS_REVIEW_FACE_MATCH_DISTANCE_THRESHOLD = 0.6;

export interface CreateBiometricCheckInput extends CreateBiometricCheckDto {
  applicantId: string;
  // Optional — see UploadDocumentInput.apiKeyId's comment in documents.service.ts.
  apiKeyId?: string;
}

@Injectable()
export class BiometricChecksService {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly applicantsService: ApplicantsService,
    private readonly biometricCheckQueue: BiometricCheckQueue,
  ) {}

  async create(input: CreateBiometricCheckInput): Promise<BiometricCheck> {
    const tx = this.requestContext.requireTx();

    // Resolving through the (extension-scoped) ApplicantsService is what
    // prevents cross-tenant FK smuggling — mirrors DocumentsService.upload.
    const applicant = await this.applicantsService.getOrThrow(
      input.applicantId,
    );

    const selfieDocument = await this.getOwnedDocumentOrThrow(
      applicant.id,
      input.selfieDocumentId,
      'SELFIE',
    );

    const referenceDocument = input.referenceDocumentId
      ? await this.getOwnedDocumentOrThrow(
          applicant.id,
          input.referenceDocumentId,
          'PASSPORT',
        )
      : await this.getMostRecentPassportOrThrow(applicant.id);

    const check = await tx.biometricCheck.create({
      data: {
        applicantId: applicant.id,
        selfieDocumentId: selfieDocument.id,
        referenceDocumentId: referenceDocument.id,
        status: 'PROCESSING',
      } as Prisma.BiometricCheckUncheckedCreateInput,
    });

    await this.biometricCheckQueue.enqueue({
      biometricCheckId: check.id,
      tenantId: check.tenantId,
      environment: check.environment,
      apiKeyId: input.apiKeyId,
    });

    return check;
  }

  async getOrThrow(id: string): Promise<BiometricCheck> {
    const tx = this.requestContext.requireTx();
    const check = await tx.biometricCheck.findUnique({ where: { id } });
    if (!check) {
      throw new NotFoundException(`Biometric check ${id} not found`);
    }
    return check;
  }

  /**
   * Flips PROCESSING (implicit — it's the create-time default, no state
   * change needed here) and returns what the worker needs, in its own
   * short transaction with the same commit-visibility retry as
   * documents.service.ts's markProcessing — paired with the enqueue-side
   * delay in BiometricCheckQueue.enqueue for the same reason.
   */
  async getForProcessing(id: string): Promise<BiometricCheck> {
    const check = await this.findCheckWithRetry(id);
    if (!check) {
      throw new NotFoundException(`Biometric check ${id} not found`);
    }
    return check;
  }

  private async findCheckWithRetry(
    id: string,
    attempts = 5,
    delayMs = 100,
  ): Promise<BiometricCheck | null> {
    const tx = this.requestContext.requireTx();
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const check = await tx.biometricCheck.findUnique({ where: { id } });
      if (check) return check;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return null;
  }

  async recordResult(id: string, result: BiometricVerifyResult): Promise<void> {
    const tx = this.requestContext.requireTx();
    const check = await tx.biometricCheck.findUnique({ where: { id } });
    if (!check) {
      throw new NotFoundException(`Biometric check ${id} not found`);
    }

    const livenessOk =
      result.liveness.verdict === 'LIVE' &&
      (result.liveness.score ?? 0) >= NEEDS_REVIEW_LIVENESS_THRESHOLD;
    const faceMatchOk =
      result.faceMatch.verdict === 'MATCH' &&
      (result.faceMatch.score ?? Number.POSITIVE_INFINITY) <=
        NEEDS_REVIEW_FACE_MATCH_DISTANCE_THRESHOLD;

    // The single field decisioning gates on later — mirrors
    // Document.status: COMPLETED only when both checks are confidently
    // good, NEEDS_REVIEW the below-threshold/UNKNOWN catch-all. See the
    // Phase 2 plan's schema section.
    const status = livenessOk && faceMatchOk ? 'COMPLETED' : 'NEEDS_REVIEW';

    await tx.biometricCheck.update({
      where: { id },
      data: {
        status,
        livenessScore: result.liveness.score,
        livenessVerdict: result.liveness.verdict,
        faceMatchScore: result.faceMatch.score,
        faceMatchVerdict: result.faceMatch.verdict,
        engine: result.engine,
        rawResult: result.rawResult as unknown as Prisma.InputJsonValue,
        processedAt: new Date(),
      },
    });
  }

  async recordFailure(id: string): Promise<void> {
    const tx = this.requestContext.requireTx();
    const check = await tx.biometricCheck.findUnique({ where: { id } });
    if (!check) {
      throw new NotFoundException(`Biometric check ${id} not found`);
    }

    await tx.biometricCheck.update({
      where: { id },
      data: { status: 'FAILED', processedAt: new Date() },
    });
  }

  private async getOwnedDocumentOrThrow(
    applicantId: string,
    documentId: string,
    expectedType: 'SELFIE' | 'PASSPORT',
  ): Promise<Document> {
    const tx = this.requestContext.requireTx();
    const document = await tx.document.findUnique({
      where: { id: documentId },
    });
    if (!document || document.applicantId !== applicantId) {
      throw new NotFoundException(
        `Document ${documentId} not found for this applicant`,
      );
    }
    if (document.type !== expectedType) {
      throw new BadRequestException(
        `Document ${documentId} is type ${document.type}, expected ${expectedType}`,
      );
    }
    return document;
  }

  private async getMostRecentPassportOrThrow(
    applicantId: string,
  ): Promise<Document> {
    const tx = this.requestContext.requireTx();
    const document = await tx.document.findFirst({
      where: { applicantId, type: 'PASSPORT' },
      orderBy: { uploadedAt: 'desc' },
    });
    if (!document) {
      throw new BadRequestException(
        `No PASSPORT document found for applicant ${applicantId} — upload one, or pass referenceDocumentId explicitly`,
      );
    }
    return document;
  }
}
