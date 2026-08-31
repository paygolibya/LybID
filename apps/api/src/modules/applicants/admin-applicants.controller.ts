import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Applicant } from '@prisma/client';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import type { AdminApplicantDetail } from './applicants.service';
import { ApplicantsService } from './applicants.service';
import { ListApplicantsDto } from './dto/list-applicants.dto';

// Same nested-under-/admin/tenants/:tenantId convention ApiKeysController /
// AdminUsageController already use. `decisionStatus` reuses the exact same
// filter as the tenant-facing route — it's the review queue there, and it's
// the review queue here too (see ListApplicantsDto's own comment).
@ApiTags('admin-applicants')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@Controller('admin/tenants/:tenantId/applicants')
export class AdminApplicantsController {
  constructor(private readonly applicantsService: ApplicantsService) {}

  @Get()
  list(
    @Param('tenantId') tenantId: string,
    @Query() query: ListApplicantsDto,
  ): Promise<Applicant[]> {
    return this.applicantsService.listForTenant(tenantId, query.decisionStatus);
  }

  @Get(':id')
  getDetail(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
  ): Promise<AdminApplicantDetail> {
    return this.applicantsService.getDetailForTenant(tenantId, id);
  }
}
