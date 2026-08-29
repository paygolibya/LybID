import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import {
  CurrentTenant,
  CurrentTenantInfo,
} from '../../common/decorators/current-tenant.decorator';
import { RequestContextService } from '../../database/tenant-context';

interface WhoamiResponse {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  environment: 'LIVE' | 'TEST';
}

@ApiTags('whoami')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('v1/whoami')
export class WhoamiController {
  constructor(private readonly requestContext: RequestContextService) {}

  @Get()
  async whoami(
    @CurrentTenant() tenant: CurrentTenantInfo,
  ): Promise<WhoamiResponse> {
    // Re-fetches Tenant through the request's tenant-scoped transaction (set
    // up by RequestTransactionInterceptor) to exercise the full app-level +
    // RLS scoping pipeline end to end, not just return what ApiKeyGuard
    // already resolved during its unscoped bootstrap lookup.
    const tx = this.requestContext.requireTx();
    const record = await tx.tenant.findFirstOrThrow();

    return {
      tenantId: record.id,
      tenantName: record.name,
      tenantSlug: record.slug,
      environment: tenant.environment,
    };
  }
}
