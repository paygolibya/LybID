import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  Applicant,
  ApplicantDecision,
  BiometricCheck,
  DecisionStatus,
  Document,
  DocumentExtraction,
  Prisma,
} from '@prisma/client';
import { RequestContextService } from '../../database/tenant-context';
import type { CreateApplicantDto } from './dto/create-applicant.dto';

// Phase 7 (admin dashboard): one round trip for an applicant's whole detail
// page — built via Prisma relation `include`s directly on Applicant
// (documents/biometricChecks/decisions are all real relations on the
// model already), rather than composing calls into DocumentsService /
// BiometricChecksService / ApplicantDecisionsService.
export interface AdminApplicantDetail extends Applicant {
  documents: (Document & { extractions: DocumentExtraction[] })[];
  biometricChecks: BiometricCheck[];
  decisions: ApplicantDecision[];
}

@Injectable()
export class ApplicantsService {
  constructor(private readonly requestContext: RequestContextService) {}

  async create(dto: CreateApplicantDto): Promise<Applicant> {
    const tx = this.requestContext.requireTx();
    // tenantId/environment are required columns in the generated Prisma
    // types, but for tenant-mode requests they're auto-injected by the
    // tenant-scoping extension (prisma-tenant.extension.ts) before the
    // query reaches the DB — never set explicitly here. The cast reflects
    // that the extension, not this call site, satisfies those fields.
    return tx.applicant.create({
      data: {
        externalId: dto.externalId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
      } as Prisma.ApplicantUncheckedCreateInput,
    });
  }

  /**
   * `decisionStatus` filters against the denormalized
   * Applicant.latestDecisionStatus column (Phase 4) — this *is* the manual
   * review queue (?decisionStatus=NEEDS_REVIEW), not a separate resource.
   */
  async list(decisionStatus?: DecisionStatus): Promise<Applicant[]> {
    const tx = this.requestContext.requireTx();
    return tx.applicant.findMany({
      where: {
        deletedAt: null,
        ...(decisionStatus ? { latestDecisionStatus: decisionStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Scoped lookup used both by the GET endpoint and by DocumentsService
   * before attaching a document — resolving through this (extension-scoped)
   * query is what prevents cross-tenant FK smuggling: an applicantId
   * belonging to another tenant resolves to null here, never reaching a
   * later insert.
   */
  async getOrThrow(id: string): Promise<Applicant> {
    const tx = this.requestContext.requireTx();
    const applicant = await tx.applicant.findUnique({ where: { id } });
    if (!applicant || applicant.deletedAt) {
      throw new NotFoundException(`Applicant ${id} not found`);
    }
    return applicant;
  }

  // --- Phase 7 (admin dashboard) — explicit-tenantId variants ---
  //
  // Everything above relies on the tenant-scoping Prisma extension to
  // silently inject `tenantId` (from the caller's API key) into every
  // query. That auto-injection never happens under admin auth — admin mode
  // intentionally bypasses app-level scoping and relies on the RLS
  // `*_admin_all` policies instead, which permit reading *any* tenant's
  // rows. So every method below filters on tenantId explicitly, the same
  // way UsageService.getSummary already does for its own admin caller —
  // this is what makes `:tenantId` in the admin routes an actual
  // constraint instead of decoration.

  /** Mirrors list(), explicitly tenant-filtered for the admin dashboard. */
  async listForTenant(
    tenantId: string,
    decisionStatus?: DecisionStatus,
  ): Promise<Applicant[]> {
    const tx = this.requestContext.requireTx();
    return tx.applicant.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(decisionStatus ? { latestDecisionStatus: decisionStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Mirrors getOrThrow(), explicitly tenant-filtered. This is the ownership
   * check every other Phase 7 admin action (decide/review, the document
   * image endpoint) must call before touching an applicant — without it,
   * `:tenantId` in an admin route would be pure decoration and any
   * applicant id from any tenant would resolve.
   */
  async getForTenantOrThrow(tenantId: string, id: string): Promise<Applicant> {
    const tx = this.requestContext.requireTx();
    const applicant = await tx.applicant.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!applicant) {
      throw new NotFoundException(
        `Applicant ${id} not found for tenant ${tenantId}`,
      );
    }
    return applicant;
  }

  /** One round trip for the admin dashboard's applicant detail page. */
  async getDetailForTenant(
    tenantId: string,
    id: string,
  ): Promise<AdminApplicantDetail> {
    const tx = this.requestContext.requireTx();
    const applicant = await tx.applicant.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        documents: {
          orderBy: { uploadedAt: 'desc' },
          include: { extractions: { orderBy: { createdAt: 'desc' }, take: 1 } },
        },
        biometricChecks: { orderBy: { createdAt: 'desc' } },
        decisions: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!applicant) {
      throw new NotFoundException(
        `Applicant ${id} not found for tenant ${tenantId}`,
      );
    }
    return applicant;
  }
}
