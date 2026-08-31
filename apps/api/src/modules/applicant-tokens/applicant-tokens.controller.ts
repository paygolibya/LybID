import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import {
  CurrentTenant,
  CurrentTenantInfo,
} from '../../common/decorators/current-tenant.decorator';
import {
  ApplicantTokensService,
  IssuedApplicantToken,
} from './applicant-tokens.service';

// Guarded by the tenant's real API key — this endpoint is server-to-server
// only. The token it returns is what actually reaches the browser; this
// endpoint itself never does.
@ApiTags('applicant-tokens')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('v1/applicants/:applicantId/session-token')
export class ApplicantTokensController {
  constructor(
    private readonly applicantTokensService: ApplicantTokensService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  issue(
    @Param('applicantId') applicantId: string,
    @CurrentTenant() tenant: CurrentTenantInfo,
  ): Promise<IssuedApplicantToken> {
    return this.applicantTokensService.issue(
      applicantId,
      tenant.tenantId,
      tenant.environment,
    );
  }
}
