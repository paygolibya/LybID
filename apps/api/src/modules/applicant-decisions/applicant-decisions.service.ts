import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ApplicantDecision,
  BiometricCheckStatus,
  DecisionStatus,
  DocumentStatus,
  Prisma,
} from '@prisma/client';
import { RequestContextService } from '../../database/tenant-context';
import { ApplicantsService } from '../applicants/applicants.service';
import type { ReviewApplicantDecisionDto } from './dto/review-applicant-decision.dto';

// A Document/BiometricCheck is "terminal" once its own async pipeline has
// finished, however it finished — including FAILED/NEEDS_REVIEW, not just
// the "good" outcome. Deciding needs to know the *result*, not just that
// nothing is UPLOADED/PROCESSING anymore.
const TERMINAL_DOCUMENT_STATUSES: ReadonlySet<DocumentStatus> = new Set([
  'EXTRACTED',
  'FAILED',
  'NEEDS_REVIEW',
]);
const TERMINAL_BIOMETRIC_STATUSES: ReadonlySet<BiometricCheckStatus> = new Set([
  'COMPLETED',
  'FAILED',
  'NEEDS_REVIEW',
]);

@Injectable()
export class ApplicantDecisionsService {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly applicantsService: ApplicantsService,
  ) {}

  /**
   * Synchronous — pure computation over rows that already exist, no
   * external I/O, so (unlike every other phase's create()) there's no
   * queue/worker here at all. See the Phase 4 plan for the full rule and
   * why REJECTED is never automatic.
   */
  async decide(applicantId: string): Promise<ApplicantDecision> {
    const tx = this.requestContext.requireTx();
    // Resolving through the (extension-scoped) ApplicantsService is what
    // prevents cross-tenant FK smuggling and gives a precise 404, same
    // pattern every other phase's service uses.
    const applicant = await this.applicantsService.getOrThrow(applicantId);

    // Directly against tx.document/tx.biometricCheck rather than through
    // DocumentsService/BiometricChecksService's public APIs — same pattern
    // BiometricChecksService itself already uses internally to read
    // Document rows it doesn't own.
    const passport = await tx.document.findFirst({
      where: { applicantId: applicant.id, type: 'PASSPORT' },
      orderBy: { uploadedAt: 'desc' },
    });
    const birthCertificate = await tx.document.findFirst({
      where: { applicantId: applicant.id, type: 'BIRTH_CERTIFICATE' },
      orderBy: { uploadedAt: 'desc' },
    });
    const biometricCheck = await tx.biometricCheck.findFirst({
      where: { applicantId: applicant.id },
      orderBy: { createdAt: 'desc' },
    });

    const missing: string[] = [];
    if (!passport) missing.push('PASSPORT document');
    if (!birthCertificate) missing.push('BIRTH_CERTIFICATE document');
    if (!biometricCheck) missing.push('biometric check');
    if (missing.length > 0) {
      throw new BadRequestException(
        `Cannot decide: missing required verification(s) for applicant ${applicantId}: ${missing.join(', ')}`,
      );
    }

    const inProgress: string[] = [];
    if (!TERMINAL_DOCUMENT_STATUSES.has(passport!.status)) {
      inProgress.push('PASSPORT document');
    }
    if (!TERMINAL_DOCUMENT_STATUSES.has(birthCertificate!.status)) {
      inProgress.push('BIRTH_CERTIFICATE document');
    }
    if (!TERMINAL_BIOMETRIC_STATUSES.has(biometricCheck!.status)) {
      inProgress.push('biometric check');
    }
    if (inProgress.length > 0) {
      throw new BadRequestException(
        `Cannot decide: still in progress for applicant ${applicantId}: ${inProgress.join(', ')}`,
      );
    }

    // APPROVED iff every underlying check reached its own "confidently
    // good" terminal state. REJECTED is never automatic — no sub-check
    // today produces a confidently-negative signal distinct from
    // NEEDS_REVIEW (BiometricCheck.status === 'COMPLETED' already means
    // both liveness and face-match passed threshold; a clear NO_MATCH and
    // a borderline one both land in NEEDS_REVIEW). See the Phase 4 plan.
    const status: DecisionStatus =
      passport!.status === 'EXTRACTED' &&
      birthCertificate!.status === 'EXTRACTED' &&
      biometricCheck!.status === 'COMPLETED'
        ? 'APPROVED'
        : 'NEEDS_REVIEW';

    const reasoning = {
      passportDocumentId: passport!.id,
      passportStatus: passport!.status,
      birthCertificateDocumentId: birthCertificate!.id,
      birthCertificateStatus: birthCertificate!.status,
      biometricCheckId: biometricCheck!.id,
      biometricCheckStatus: biometricCheck!.status,
    };

    const decision = await tx.applicantDecision.create({
      data: {
        applicantId: applicant.id,
        // Explicit, not left to the tenant-scoping extension's
        // auto-injection (Phase 7 finding): admin-mode requests bypass
        // that injection entirely (see prisma-tenant.extension.ts —
        // `if (auth.mode === 'admin') return args`), and this service is
        // now called from both the tenant-facing route and the Phase 7
        // admin dashboard route. Sourcing these from the already-fetched
        // `applicant` row (not the auth context) makes this correct under
        // every auth mode without this service needing to know which one
        // is calling it.
        tenantId: applicant.tenantId,
        environment: applicant.environment,
        status,
        reasoning: reasoning as unknown as Prisma.InputJsonValue,
      } as Prisma.ApplicantDecisionUncheckedCreateInput,
    });

    await tx.applicant.update({
      where: { id: applicant.id },
      data: { latestDecisionStatus: status },
    });

    return decision;
  }

  async getLatestOrThrow(applicantId: string): Promise<ApplicantDecision> {
    const tx = this.requestContext.requireTx();
    await this.applicantsService.getOrThrow(applicantId);
    const decision = await tx.applicantDecision.findFirst({
      where: { applicantId },
      orderBy: { createdAt: 'desc' },
    });
    if (!decision) {
      throw new NotFoundException(
        `No decision found for applicant ${applicantId} — call POST .../decision first`,
      );
    }
    return decision;
  }

  /**
   * Manual override, restricted to resolving a NEEDS_REVIEW decision — a
   * deliberate v1 scope limit, not a hard constraint of the data model.
   * Overriding an already-APPROVED/REJECTED decision is a real future
   * need, deferred (see the Phase 4 plan).
   */
  async review(
    applicantId: string,
    dto: ReviewApplicantDecisionDto,
  ): Promise<ApplicantDecision> {
    const tx = this.requestContext.requireTx();
    const applicant = await this.applicantsService.getOrThrow(applicantId);
    const latest = await this.getLatestOrThrow(applicantId);

    if (latest.status !== 'NEEDS_REVIEW') {
      throw new BadRequestException(
        `Cannot review: latest decision for applicant ${applicantId} is ${latest.status}, not NEEDS_REVIEW`,
      );
    }

    const decision = await tx.applicantDecision.create({
      data: {
        applicantId: applicant.id,
        // See decide()'s identical comment — explicit, not left to the
        // extension's auto-injection, which admin-mode requests bypass.
        tenantId: applicant.tenantId,
        environment: applicant.environment,
        status: dto.status,
        reasoning: {
          manualReview: true,
          previousDecisionId: latest.id,
        } as unknown as Prisma.InputJsonValue,
        reviewerId: dto.reviewerId,
        reviewNotes: dto.notes,
      } as Prisma.ApplicantDecisionUncheckedCreateInput,
    });

    await tx.applicant.update({
      where: { id: applicant.id },
      data: { latestDecisionStatus: dto.status },
    });

    return decision;
  }
}
