import { Injectable } from '@nestjs/common';
import type { ApiKeyEnvironment, Prisma } from '@prisma/client';
import { RequestContextService } from '../../database/tenant-context';

export interface UsageSummary {
  from: Date;
  to: Date;
  environment: ApiKeyEnvironment;
  counts: Record<string, number>;
  total: number;
}

export interface GetUsageSummaryInput {
  tenantId: string;
  environment?: ApiKeyEnvironment;
  from?: Date;
  to?: Date;
}

@Injectable()
export class UsageService {
  constructor(private readonly requestContext: RequestContextService) {}

  /** Called from DocumentsService.recordExtractionResult() — see the
   * Phase 5 plan for why only EXTRACTED/NEEDS_REVIEW call this, not FAILED. */
  async recordDocumentProcessed(documentId: string): Promise<void> {
    const tx = this.requestContext.requireTx();
    await tx.usageRecord.create({
      data: {
        documentId,
        type: 'DOCUMENT_PROCESSED',
      } as Prisma.UsageRecordUncheckedCreateInput,
    });
  }

  /** Mirrors recordDocumentProcessed exactly, for BusinessDocumentsService. */
  async recordBusinessDocumentProcessed(
    businessDocumentId: string,
  ): Promise<void> {
    const tx = this.requestContext.requireTx();
    await tx.usageRecord.create({
      data: {
        businessDocumentId,
        type: 'DOCUMENT_PROCESSED',
      } as Prisma.UsageRecordUncheckedCreateInput,
    });
  }

  /**
   * Always filters explicitly on tenantId — never relies on the
   * tenant-scoping extension's auto-injection, unlike every other read in
   * this codebase. This is the only groupBy query anywhere here; rather
   * than auditing whether the extension's operation-matching covers
   * groupBy the way it's proven to for findMany/findUnique/etc., this
   * sidesteps the question entirely. Used by both the tenant-facing
   * controller (passes its own tenantId) and the admin controller (passes
   * the :tenantId route param) — admin mode has no auto-scoping to rely on
   * anyway, so this one implementation correctly serves both callers.
   */
  async getSummary(input: GetUsageSummaryInput): Promise<UsageSummary> {
    const tx = this.requestContext.requireTx();
    const environment = input.environment ?? 'LIVE';
    const now = new Date();
    const from = input.from ?? new Date(now.getFullYear(), now.getMonth(), 1);
    const to = input.to ?? now;

    const grouped = await tx.usageRecord.groupBy({
      by: ['type'],
      where: {
        tenantId: input.tenantId,
        environment,
        createdAt: { gte: from, lte: to },
      },
      _count: { _all: true },
    });

    const counts: Record<string, number> = {};
    let total = 0;
    for (const row of grouped) {
      counts[row.type] = row._count._all;
      total += row._count._all;
    }

    return { from, to, environment, counts, total };
  }
}
