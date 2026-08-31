import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Applicant } from '@prisma/client';
import { RequestContextService } from '../../database/tenant-context';
import { ApplicantsService } from '../applicants/applicants.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { StorageService } from '../documents/storage/storage.service';

// A new module rather than a method on ApplicantsService, mirroring the
// precedent ApplicantDecisionsModule already set in Phase 4: erasure needs
// StorageService (owned by DocumentsModule), and DocumentsModule already
// imports ApplicantsModule — importing DocumentsModule back from
// ApplicantsModule would be a circular dependency. A separate module that
// imports both, one-directionally, avoids it entirely.
@Injectable()
export class ApplicantErasureService {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly applicantsService: ApplicantsService,
    private readonly storage: StorageService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Bank-triggered erasure (Phase 8) — confirmed scope: purge raw document
   * images + OCR-extracted PII, but keep the decision history so
   * compliance records survive. Deliberately does NOT touch
   * BiometricCheck's own scores/verdicts or any ApplicantDecision row —
   * those are the compliance record, not raw PII. Deliberately does NOT
   * set `deletedAt` either — see Applicant.erasedAt's schema comment for
   * why that would defeat the point (deletedAt hides the row from every
   * read in this codebase; erasedAt marks it purged while staying
   * visible).
   */
  async erase(applicantId: string): Promise<Applicant> {
    const tx = this.requestContext.requireTx();
    // Resolving through the (extension-scoped) ApplicantsService is what
    // prevents cross-tenant FK smuggling and gives a precise 404 — same
    // pattern every other service in this codebase uses.
    const applicant = await this.applicantsService.getOrThrow(applicantId);

    const documents = await tx.document.findMany({
      where: { applicantId: applicant.id },
    });
    for (const document of documents) {
      await this.storage.deleteObject(document.storageKey);
      await tx.documentExtraction.updateMany({
        where: { documentId: document.id },
        data: { rawText: null, fields: Prisma.DbNull },
      });
    }

    const erased = await tx.applicant.update({
      where: { id: applicant.id },
      data: {
        firstName: null,
        lastName: null,
        dateOfBirth: null,
        externalId: null,
        erasedAt: new Date(),
      },
    });

    await this.auditLog.recordForCurrentActor({
      action: 'applicant.erase',
      targetType: 'applicant',
      targetId: applicant.id,
      metadata: { documentCount: documents.length },
    });

    return erased;
  }
}
