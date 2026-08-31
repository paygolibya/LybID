import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuditLog } from '@prisma/client';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { AuditLogService } from './audit-log.service';
import { ListAuditLogDto } from './dto/list-audit-log.dto';

// Phase 8 — the read endpoint AuditLogService's own Phase 0 comment
// deferred ("no read endpoint... yet, Phase 8 decision"). Admin-only, same
// /admin/* convention as every other Marsa-internal-only route.
@ApiTags('admin-audit-log')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@Controller('admin/audit-log')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  list(@Query() query: ListAuditLogDto): Promise<AuditLog[]> {
    return this.auditLogService.list({
      tenantId: query.tenantId,
      targetType: query.targetType,
      targetId: query.targetId,
      action: query.action,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: query.limit,
    });
  }
}
