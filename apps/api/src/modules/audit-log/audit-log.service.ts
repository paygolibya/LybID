import { Injectable } from '@nestjs/common';
import { RequestContextService } from '../../database/tenant-context';

export interface AuditLogEntry {
  actorType: 'platform_admin';
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Write-only for Phase 0 — no read endpoint or retention policy yet (both
 * are Phase 8 decisions). AuditLog is not tenant-scoped, so writes go
 * through the current request's transaction directly without the
 * tenant-scoping extension applying any filter.
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly requestContext: RequestContextService) {}

  async record(entry: AuditLogEntry): Promise<void> {
    const tx = this.requestContext.requireTx();
    await tx.auditLog.create({ data: entry });
  }
}
