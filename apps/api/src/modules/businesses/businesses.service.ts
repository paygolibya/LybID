import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  Business,
  BusinessDecision,
  BusinessDocument,
  BusinessDocumentExtraction,
  DecisionStatus,
  Prisma,
} from '@prisma/client';
import { RequestContextService } from '../../database/tenant-context';
import type { CreateBusinessDto } from './dto/create-business.dto';

// Mirrors ApplicantsService's AdminApplicantDetail exactly, for Business.
export interface AdminBusinessDetail extends Business {
  documents: (BusinessDocument & {
    extractions: BusinessDocumentExtraction[];
  })[];
  decisions: BusinessDecision[];
}

@Injectable()
export class BusinessesService {
  constructor(private readonly requestContext: RequestContextService) {}

  async create(dto: CreateBusinessDto): Promise<Business> {
    const tx = this.requestContext.requireTx();
    // tenantId/environment are required columns in the generated Prisma
    // types, but for tenant-mode requests they're auto-injected by the
    // tenant-scoping extension (prisma-tenant.extension.ts) before the
    // query reaches the DB — never set explicitly here. The cast reflects
    // that the extension, not this call site, satisfies those fields.
    return tx.business.create({
      data: {
        externalId: dto.externalId,
        legalName: dto.legalName,
        commercialRegistrationNumber: dto.commercialRegistrationNumber,
      } as Prisma.BusinessUncheckedCreateInput,
    });
  }

  /**
   * `decisionStatus` filters against the denormalized
   * Business.latestDecisionStatus column (Phase 4) — this *is* the manual
   * review queue (?decisionStatus=NEEDS_REVIEW), not a separate resource.
   */
  async list(decisionStatus?: DecisionStatus): Promise<Business[]> {
    const tx = this.requestContext.requireTx();
    return tx.business.findMany({
      where: {
        deletedAt: null,
        ...(decisionStatus ? { latestDecisionStatus: decisionStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Scoped lookup used both by the GET endpoint and by BusinessDocumentsService
   * before attaching a document — resolving through this (extension-scoped)
   * query is what prevents cross-tenant FK smuggling: a businessId
   * belonging to another tenant resolves to null here, never reaching a
   * later insert.
   */
  async getOrThrow(id: string): Promise<Business> {
    const tx = this.requestContext.requireTx();
    const business = await tx.business.findUnique({ where: { id } });
    if (!business || business.deletedAt) {
      throw new NotFoundException(`Business ${id} not found`);
    }
    return business;
  }

  // --- Phase 7 (admin dashboard) — explicit-tenantId variants ---
  // See ApplicantsService's identical section for the full rationale.

  async listForTenant(
    tenantId: string,
    decisionStatus?: DecisionStatus,
  ): Promise<Business[]> {
    const tx = this.requestContext.requireTx();
    return tx.business.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(decisionStatus ? { latestDecisionStatus: decisionStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getForTenantOrThrow(tenantId: string, id: string): Promise<Business> {
    const tx = this.requestContext.requireTx();
    const business = await tx.business.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!business) {
      throw new NotFoundException(
        `Business ${id} not found for tenant ${tenantId}`,
      );
    }
    return business;
  }

  async getDetailForTenant(
    tenantId: string,
    id: string,
  ): Promise<AdminBusinessDetail> {
    const tx = this.requestContext.requireTx();
    const business = await tx.business.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        documents: {
          orderBy: { uploadedAt: 'desc' },
          include: { extractions: { orderBy: { createdAt: 'desc' }, take: 1 } },
        },
        decisions: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!business) {
      throw new NotFoundException(
        `Business ${id} not found for tenant ${tenantId}`,
      );
    }
    return business;
  }
}
