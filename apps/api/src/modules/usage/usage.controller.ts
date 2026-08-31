import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import {
  CurrentTenant,
  CurrentTenantInfo,
} from '../../common/decorators/current-tenant.decorator';
import { GetUsageQueryDto } from './dto/get-usage-query.dto';
import { UsageService, UsageSummary } from './usage.service';

@ApiTags('usage')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('v1/usage')
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @Get()
  getSummary(
    @Query() query: GetUsageQueryDto,
    @CurrentTenant() tenant: CurrentTenantInfo,
  ): Promise<UsageSummary> {
    return this.usageService.getSummary({
      tenantId: tenant.tenantId,
      // Always the authenticated key's own environment, never
      // client-controlled — see GetUsageQueryDto's comment for why.
      environment: tenant.environment,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }
}
