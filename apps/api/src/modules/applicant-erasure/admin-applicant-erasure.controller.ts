import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Applicant } from '@prisma/client';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { ApplicantsService } from '../applicants/applicants.service';
import { ApplicantErasureService } from './applicant-erasure.service';

// Same nested-under-/admin/tenants/:tenantId convention every other Phase 7
// admin controller uses, added here in the same pass that gave the
// admin-dashboard UI an erase button — Phase 8's own erasure work
// deliberately left this out ("no admin-dashboard mirror this phase").
// Same ownership-check-before-delegating pattern as
// AdminApplicantDecisionsController: ApplicantErasureService.erase()
// resolves the applicant via ApplicantsService.getOrThrow(), which has no
// tenant filter under admin auth — getForTenantOrThrow() here is what
// makes `:tenantId` in the URL an actual constraint, not decoration.
@ApiTags('admin-applicant-erasure')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@Controller('admin/tenants/:tenantId/applicants/:id')
export class AdminApplicantErasureController {
  constructor(
    private readonly applicantsService: ApplicantsService,
    private readonly applicantErasureService: ApplicantErasureService,
  ) {}

  @Post('erase')
  @HttpCode(HttpStatus.OK)
  async erase(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
  ): Promise<Applicant> {
    await this.applicantsService.getForTenantOrThrow(tenantId, id);
    return this.applicantErasureService.erase(id);
  }
}
