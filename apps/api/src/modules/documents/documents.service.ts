import { Injectable, NotFoundException } from '@nestjs/common';
import type { Document, DocumentType, Prisma } from '@prisma/client';
import { RequestContextService } from '../../database/tenant-context';
import { ApplicantsService } from '../applicants/applicants.service';
import { UsageService } from '../usage/usage.service';
import type { ValidatedFile } from './file-validation.util';
import type { OcrExtractionResult } from './ocr-client/ocr-client.service';
import { ExtractionQueue } from './queue/extraction.queue';
import { StorageService } from './storage/storage.service';

// Below this, a document is flagged for human review instead of trusted
// outright. Tunable — not derived from real-world data yet (see the Phase 1
// plan's note on birth-certificate extraction quality being unverified
// against a real sample).
const NEEDS_REVIEW_CONFIDENCE_THRESHOLD = 0.75;

// Explicit allow-list, not "every type except SELFIE" — safer against a
// future document type (e.g. Phase 3 KYB documents) silently opting into
// OCR by default. A SELFIE Document stays in UPLOADED status permanently;
// it's processed later via a BiometricCheck, not this row's own status
// machine (see the Phase 2 plan).
const OCR_DOCUMENT_TYPES: ReadonlySet<DocumentType> = new Set([
  'PASSPORT',
  'BIRTH_CERTIFICATE',
]);

export interface UploadDocumentInput {
  applicantId: string;
  type: DocumentType;
  buffer: Buffer;
  originalFilename: string;
  validated: ValidatedFile;
  apiKeyId: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly applicantsService: ApplicantsService,
    private readonly storage: StorageService,
    private readonly extractionQueue: ExtractionQueue,
    private readonly usage: UsageService,
  ) {}

  async upload(input: UploadDocumentInput): Promise<Document> {
    const tx = this.requestContext.requireTx();

    // Resolving through the (extension-scoped) ApplicantsService is what
    // prevents cross-tenant FK smuggling — a cross-tenant applicantId
    // throws NotFoundException here, before any Document row is created.
    const applicant = await this.applicantsService.getOrThrow(
      input.applicantId,
    );

    const document = await tx.document.create({
      data: {
        applicantId: applicant.id,
        type: input.type,
        status: 'UPLOADED',
        storageKey: '', // set below, after we know the document id
        originalFilename: input.originalFilename,
        mimeType: input.validated.mimeType,
        fileSizeBytes: input.buffer.length,
        sha256: input.validated.sha256,
      } as Prisma.DocumentUncheckedCreateInput,
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
    const updated = await tx.document.update({
      where: { id: document.id },
      data: { storageKey },
    });

    if (OCR_DOCUMENT_TYPES.has(input.type)) {
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
    const document = await tx.document.findUnique({ where: { id } });
    if (!document) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    const latestExtraction = await tx.documentExtraction.findFirst({
      where: { documentId: id },
      orderBy: { createdAt: 'desc' },
    });
    return { ...document, latestExtraction };
  }

  /**
   * Flips UPLOADED -> PROCESSING and returns the document, in its own short
   * transaction. The worker calls this, then does the slow OCR call
   * *outside* any transaction, then calls recordExtractionResult /
   * recordExtractionFailure in a second short transaction — deliberately
   * three separate transactions, not one spanning the whole attempt.
   * Prisma's interactive-transaction default timeout is 5s and OCR can
   * exceed that; holding a DB transaction open across a multi-second
   * external HTTP call is a hazard independent of that timeout anyway (ties
   * up a pooled connection, holds row locks). A crash mid-PROCESSING is
   * recovered by BullMQ's own retry, not by transactional rollback — this
   * is safe because DocumentExtraction rows are additive history and the
   * terminal-state update is idempotent, not because PROCESSING itself is
   * transactionally reversible.
   *
   * Paired with the enqueue-side delay in ExtractionQueue.enqueue: this is
   * the first place the worker reads the Document row, so it's the one
   * that can lose the race against the enqueueing request's transaction
   * commit. A short retry here is cheap defense-in-depth on top of that
   * delay — it does NOT retry NotFoundException from genuinely-missing
   * documents forever, just enough to absorb ordinary commit latency.
   */
  async markProcessing(documentId: string): Promise<Document> {
    const tx = this.requestContext.requireTx();
    const document = await this.findDocumentWithRetry(documentId);
    if (!document) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }
    return tx.document.update({
      where: { id: documentId },
      data: { status: 'PROCESSING' },
    });
  }

  private async findDocumentWithRetry(
    documentId: string,
    attempts = 5,
    delayMs = 100,
  ): Promise<Document | null> {
    const tx = this.requestContext.requireTx();
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const document = await tx.document.findUnique({
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
    const document = await tx.document.findUnique({
      where: { id: documentId },
    });
    if (!document) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }

    await tx.documentExtraction.create({
      data: {
        documentId: document.id,
        engine: 'tesseract-5',
        rawText: result.rawText,
        fields: result.fields as unknown as Prisma.InputJsonValue,
        overallConfidence: result.overallConfidence,
        status: 'COMPLETED',
      } as Prisma.DocumentExtractionUncheckedCreateInput,
    });

    await tx.document.update({
      where: { id: document.id },
      data: {
        status:
          result.overallConfidence < NEEDS_REVIEW_CONFIDENCE_THRESHOLD
            ? 'NEEDS_REVIEW'
            : 'EXTRACTED',
        processedAt: new Date(),
      },
    });

    // Phase 5: a real OCR outcome (EXTRACTED or NEEDS_REVIEW, whichever it
    // landed on above) is what's billable — not attempted here for
    // recordExtractionFailure below, since that's LybID's own
    // infrastructure failing, not verification work done for the tenant.
    await this.usage.recordDocumentProcessed(document.id);
  }

  /** The error itself is logged by the caller (the BullMQ processor) — this just records the terminal state. */
  async recordExtractionFailure(documentId: string): Promise<void> {
    const tx = this.requestContext.requireTx();
    const document = await tx.document.findUnique({
      where: { id: documentId },
    });
    if (!document) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }

    await tx.documentExtraction.create({
      data: {
        documentId: document.id,
        engine: 'tesseract-5',
        status: 'FAILED',
      } as Prisma.DocumentExtractionUncheckedCreateInput,
    });

    await tx.document.update({
      where: { id: document.id },
      data: { status: 'FAILED', processedAt: new Date() },
    });
  }
}
