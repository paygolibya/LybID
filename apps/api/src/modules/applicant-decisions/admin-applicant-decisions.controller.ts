import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { ApplicantDecision } from '@prisma/client';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import {
  CurrentAdmin,
  CurrentAdminInfo,
} from '../../common/decorators/current-admin.decorator';
import { ApplicantsService } from '../applicants/applicants.service';
import { ApplicantDecisionsService } from './applicant-decisions.service';
import { AdminReviewApplicantDecisionDto } from './dto/admin-review-applicant-decision.dto';

// Same nested-under-/admin/tenants/:tenantId convention every other Phase 7
// admin controller uses. Every action here calls
// ApplicantsService.getForTenantOrThrow() FIRST, before touching
// ApplicantDecisionsService — that's the ownership check that makes
// `:tenantId` in the URL an actual constraint (see its own comment for
// why: ApplicantDecisionsService.decide()/review() resolve the applicant
// via ApplicantsService.getOrThrow(), which under admin auth has no
// tenant filter at all).
@ApiTags('admin-applicant-decisions')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@Controller('admin/tenants/:tenantId/applicants/:applicantId')
export class AdminApplicantDecisionsController {
  constructor(
    private readonly applicantsService: ApplicantsService,
    private readonly applicantDecisionsService: ApplicantDecisionsService,
  ) {}

  // Admin-triggered recompute — useful for ops/support when a bank's own
  // backend hasn't called this itself. Same 201 (synchronous, no queue) as
  // the tenant-facing route.
  @Post('decision')
  @HttpCode(HttpStatus.CREATED)
  async decide(
    @Param('tenantId') tenantId: string,
    @Param('applicantId') applicantId: string,
  ): Promise<ApplicantDecision> {
    await this.applicantsService.getForTenantOrThrow(tenantId, applicantId);
    return this.applicantDecisionsService.decide(applicantId);
  }

  @Post('decision/review')
  @HttpCode(HttpStatus.CREATED)
  async review(
    @Param('tenantId') tenantId: string,
    @Param('applicantId') applicantId: string,
    @Body() dto: AdminReviewApplicantDecisionDto,
    @CurrentAdmin() admin: CurrentAdminInfo,
  ): Promise<ApplicantDecision> {
    await this.applicantsService.getForTenantOrThrow(tenantId, applicantId);
    return this.applicantDecisionsService.review(applicantId, {
      status: dto.status,
      // The real reviewer identity, not client-supplied free text — see
      // the DTO's own comment.
      reviewerId: admin.email,
      notes: dto.notes,
    });
  }
}
