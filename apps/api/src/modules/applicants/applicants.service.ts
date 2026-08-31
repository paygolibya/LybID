import { Injectable, NotFoundException } from '@nestjs/common';
import type { Applicant, DecisionStatus, Prisma } from '@prisma/client';
import { RequestContextService } from '../../database/tenant-context';
import type { CreateApplicantDto } from './dto/create-applicant.dto';

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
}
