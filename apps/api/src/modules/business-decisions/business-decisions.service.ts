import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  BusinessDecision,
  DecisionStatus,
  DocumentStatus,
  Prisma,
} from '@prisma/client';
import { RequestContextService } from '../../database/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import { BusinessesService } from '../businesses/businesses.service';
import type { ReviewBusinessDecisionDto } from './dto/review-business-decision.dto';

// See applicant-decisions.service.ts's identical constant for why this
// includes FAILED/NEEDS_REVIEW, not just the "good" outcome.
const TERMINAL_DOCUMENT_STATUSES: ReadonlySet<DocumentStatus> = new Set([
  'EXTRACTED',
  'FAILED',
  'NEEDS_REVIEW',
]);

// Mirrors the three Phase 3 KYB document types — see documents/service.ts's
// KYB_OCR_DOCUMENT_TYPES for the same explicit-list discipline.
const REQUIRED_BUSINESS_DOCUMENT_TYPES = [
  'COMMERCIAL_REGISTRATION',
  'CHAMBER_OF_COMMERCE',
  'TAX_ID',
] as const;

@Injectable()
export class BusinessDecisionsService {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly businessesService: BusinessesService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Mirrors ApplicantDecisionsService.decide() exactly — see its comments
   * for the full rationale (synchronous, no queue; REJECTED never automatic). */
  async decide(businessId: string): Promise<BusinessDecision> {
    const tx = this.requestContext.requireTx();
    const business = await this.businessesService.getOrThrow(businessId);

    const documentsByType = new Map<
      (typeof REQUIRED_BUSINESS_DOCUMENT_TYPES)[number],
      Awaited<ReturnType<typeof tx.businessDocument.findFirst>>
    >();
    for (const type of REQUIRED_BUSINESS_DOCUMENT_TYPES) {
      const document = await tx.businessDocument.findFirst({
        where: { businessId: business.id, type },
        orderBy: { uploadedAt: 'desc' },
      });
      documentsByType.set(type, document);
    }

    const missing = REQUIRED_BUSINESS_DOCUMENT_TYPES.filter(
      (type) => !documentsByType.get(type),
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        `Cannot decide: missing required document(s) for business ${businessId}: ${missing.join(', ')}`,
      );
    }

    const inProgress = REQUIRED_BUSINESS_DOCUMENT_TYPES.filter(
      (type) =>
        !TERMINAL_DOCUMENT_STATUSES.has(documentsByType.get(type)!.status),
    );
    if (inProgress.length > 0) {
      throw new BadRequestException(
        `Cannot decide: still in progress for business ${businessId}: ${inProgress.join(', ')}`,
      );
    }

    // APPROVED iff every required document reached EXTRACTED. REJECTED is
    // never automatic here either — there's no equivalent of a
    // "confidently negative" signal for a KYB document the way a biometric
    // face-match could theoretically provide one; see the Phase 4 plan.
    const allExtracted = REQUIRED_BUSINESS_DOCUMENT_TYPES.every(
      (type) => documentsByType.get(type)!.status === 'EXTRACTED',
    );
    const status: DecisionStatus = allExtracted ? 'APPROVED' : 'NEEDS_REVIEW';

    const reasoning: Record<string, unknown> = {};
    for (const type of REQUIRED_BUSINESS_DOCUMENT_TYPES) {
      const document = documentsByType.get(type)!;
      reasoning[`${type.toLowerCase()}DocumentId`] = document.id;
      reasoning[`${type.toLowerCase()}Status`] = document.status;
    }

    const decision = await tx.businessDecision.create({
      data: {
        businessId: business.id,
        // Explicit, not left to the extension's auto-injection — see
        // ApplicantDecisionsService.decide()'s identical comment (this
        // service is now called from both the tenant route and the Phase 7
        // admin dashboard route, and admin-mode requests bypass that
        // injection entirely).
        tenantId: business.tenantId,
        environment: business.environment,
        status,
        reasoning: reasoning as unknown as Prisma.InputJsonValue,
      } as Prisma.BusinessDecisionUncheckedCreateInput,
    });

    await tx.business.update({
      where: { id: business.id },
      data: { latestDecisionStatus: status },
    });

    return decision;
  }

  async getLatestOrThrow(businessId: string): Promise<BusinessDecision> {
    const tx = this.requestContext.requireTx();
    await this.businessesService.getOrThrow(businessId);
    const decision = await tx.businessDecision.findFirst({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
    if (!decision) {
      throw new NotFoundException(
        `No decision found for business ${businessId} — call POST .../decision first`,
      );
    }
    return decision;
  }

  /** Mirrors ApplicantDecisionsService.review() exactly. */
  async review(
    businessId: string,
    dto: ReviewBusinessDecisionDto,
  ): Promise<BusinessDecision> {
    const tx = this.requestContext.requireTx();
    const business = await this.businessesService.getOrThrow(businessId);
    const latest = await this.getLatestOrThrow(businessId);

    if (latest.status !== 'NEEDS_REVIEW') {
      throw new BadRequestException(
        `Cannot review: latest decision for business ${businessId} is ${latest.status}, not NEEDS_REVIEW`,
      );
    }

    const decision = await tx.businessDecision.create({
      data: {
        businessId: business.id,
        tenantId: business.tenantId,
        environment: business.environment,
        status: dto.status,
        reasoning: {
          manualReview: true,
          previousDecisionId: latest.id,
        } as unknown as Prisma.InputJsonValue,
        reviewerId: dto.reviewerId,
        reviewNotes: dto.notes,
      } as Prisma.BusinessDecisionUncheckedCreateInput,
    });

    await tx.business.update({
      where: { id: business.id },
      data: { latestDecisionStatus: dto.status },
    });

    // See ApplicantDecisionsService.review()'s identical comment.
    await this.auditLog.recordForCurrentActor({
      action: 'business.decision.review',
      targetType: 'business_decision',
      targetId: decision.id,
      // See ApplicantDecisionsService.review()'s identical comment.
      tenantId: business.tenantId,
      metadata: { businessId: business.id, status: dto.status },
    });

    return decision;
  }
}
