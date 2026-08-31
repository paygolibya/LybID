import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { GetAdminUsageQueryDto } from './dto/get-admin-usage-query.dto';
import { UsageService, UsageSummary } from './usage.service';

// Same nested-under-/admin/tenants/:tenantId convention ApiKeysController
// already uses for tenant-scoped admin routes.
@ApiTags('admin-usage')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@Controller('admin')
export class AdminUsageController {
  constructor(private readonly usageService: UsageService) {}

  @Get('tenants/:tenantId/usage')
  getSummary(
    @Param('tenantId') tenantId: string,
    @Query() query: GetAdminUsageQueryDto,
  ): Promise<UsageSummary> {
    return this.usageService.getSummary({
      tenantId,
      environment: query.environment,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }
}
