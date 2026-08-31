import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Applicant } from '@prisma/client';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { ApplicantErasureService } from './applicant-erasure.service';

// Tenant API-key only — deliberately not reachable via an applicant-session
// token (that route tree, ApplicantSessionModule, never mounts this), and
// no Phase 7 admin-dashboard mirror this phase. A bank's own backend calls
// this on its own initiative; there is no "please delete my data" consumer-
// facing flow anywhere in this system.
@ApiTags('applicant-erasure')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('v1/applicants/:id')
export class ApplicantErasureController {
  constructor(
    private readonly applicantErasureService: ApplicantErasureService,
  ) {}

  @Post('erase')
  @HttpCode(HttpStatus.OK)
  erase(@Param('id') id: string): Promise<Applicant> {
    return this.applicantErasureService.erase(id);
  }
}
