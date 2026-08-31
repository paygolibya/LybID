import { Injectable } from '@nestjs/common';
import type { AuditLog } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RequestContextService } from '../../database/tenant-context';

export interface AuditLogEntry {
  // Phase 8: widened from 'platform_admin' only — a tenant-triggered
  // action (e.g. erasure, or a review made via the tenant's own API key
  // rather than the Phase 7 admin dashboard) needs to be auditable too.
  actorType: 'platform_admin' | 'tenant';
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  // The tenant this action is associated with, if any — see the schema
  // comment on AuditLog.tenantId for why this exists separately from
  // actorId (actorId is *who acted*, not necessarily which tenant the
  // action was about).
  tenantId?: string;
  metadata?: Record<string, unknown>;
}

export interface ListAuditLogFilters {
  tenantId?: string;
  targetType?: string;
  targetId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

/**
 * AuditLog is not tenant-scoped (see the rls_setup migration's own
 * comment — no RLS, role-level GRANTs only), so `TENANT_SCOPED_MODELS`
 * doesn't include it and the tenant-scoping extension is a no-op for it
 * regardless of auth state. That's what makes `record()` safe to call with
 * no request transaction open at all — see its own comment.
 */
@Injectable()
export class AuditLogService {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Phase 0 only ever called this from inside an already-open request
   * transaction (every guarded route has one by the time app code runs).
   * Phase 8 needs to audit admin login attempts too — `POST
   * /admin/auth/login` has no guard, so no auth context and no
   * transaction exist yet at that point. Falls back to the plain
   * (non-transactional) client rather than throwing; safe specifically
   * because AuditLog has no RLS/scoping to bypass.
   */
  async record(entry: AuditLogEntry): Promise<void> {
    const tx = this.requestContext.getTx();
    const db = tx ?? this.prisma.client;
    await db.auditLog.create({ data: entry });
  }

  /**
   * `record()` for the common case: actor + tenantId derived from the
   * current request's auth context rather than the caller working out
   * which field means what per auth mode. Used by services reachable from
   * both a tenant's own API key and the Phase 7 admin dashboard (decision
   * review, erasure) — both flow through the same service method, so the
   * actor genuinely varies per call, not per code path.
   *
   * `tenantId` on `entry` is an optional explicit override — the admin
   * branch has no tenantId of its own to fall back to (an admin JWT isn't
   * tied to one tenant), so without this, every admin-triggered action
   * would be invisible when filtering GET /admin/audit-log to one
   * tenant's trail, even though the action was clearly about that
   * tenant. Admin-scoped call sites (AdminApplicantDecisionsController's
   * review, the admin erasure routes) already resolve and ownership-check
   * the tenant before calling in, so they're expected to pass it
   * explicitly. Tenant/applicant-mode calls don't need to — their own
   * auth.tenantId is already correct — but can still override it.
   */
  async recordForCurrentActor(
    entry: Omit<AuditLogEntry, 'actorType' | 'actorId' | 'tenantId'> & {
      tenantId?: string;
    },
  ): Promise<void> {
    const auth = this.requestContext.requireAuth();
    if (auth.mode === 'admin') {
      return this.record({
        ...entry,
        actorType: 'platform_admin',
        actorId: auth.adminId,
      });
    }
    // 'tenant' and 'applicant' modes both carry tenantId; a raw API key
    // has no more specific actor id than the key itself (apiKeyId is
    // optional — omitted for applicant-session-originated calls, see
    // RequestAuthContext's own comment), so fall back to tenantId.
    return this.record({
      ...entry,
      tenantId: entry.tenantId ?? auth.tenantId,
      actorType: 'tenant',
      actorId:
        auth.mode === 'tenant'
          ? (auth.apiKeyId ?? auth.tenantId)
          : auth.applicantId,
    });
  }

  /**
   * Backs `GET /admin/audit-log`. Always via the plain client, not
   * `requireTx()` — this is inherently a cross-tenant admin view (the
   * `tenantId` filter is a plain `where` clause, not scoping), and every
   * caller is already behind AdminJwtGuard, which doesn't open a
   * tenant-filtered transaction anyway (see RequestTransactionInterceptor's
   * 'admin' branch). Ordered newest-first, capped — unlike every other
   * list endpoint in this codebase, audit logs have no natural per-tenant
   * growth bound (every action across every tenant adds a row here).
   */
  async list(filters: ListAuditLogFilters): Promise<AuditLog[]> {
    const limit = Math.min(filters.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    return this.prisma.client.auditLog.findMany({
      where: {
        ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
        ...(filters.targetType ? { targetType: filters.targetType } : {}),
        ...(filters.targetId ? { targetId: filters.targetId } : {}),
        ...(filters.action ? { action: filters.action } : {}),
        ...(filters.from || filters.to
          ? {
              createdAt: {
                ...(filters.from ? { gte: filters.from } : {}),
                ...(filters.to ? { lte: filters.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
