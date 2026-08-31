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
import type { BusinessDecision } from '@prisma/client';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import {
  CurrentAdmin,
  CurrentAdminInfo,
} from '../../common/decorators/current-admin.decorator';
import { BusinessesService } from '../businesses/businesses.service';
import { BusinessDecisionsService } from './business-decisions.service';
import { AdminReviewBusinessDecisionDto } from './dto/admin-review-business-decision.dto';

// Mirrors AdminApplicantDecisionsController exactly, for Business.
@ApiTags('admin-business-decisions')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@Controller('admin/tenants/:tenantId/businesses/:businessId')
export class AdminBusinessDecisionsController {
  constructor(
    private readonly businessesService: BusinessesService,
    private readonly businessDecisionsService: BusinessDecisionsService,
  ) {}

  @Post('decision')
  @HttpCode(HttpStatus.CREATED)
  async decide(
    @Param('tenantId') tenantId: string,
    @Param('businessId') businessId: string,
  ): Promise<BusinessDecision> {
    await this.businessesService.getForTenantOrThrow(tenantId, businessId);
    return this.businessDecisionsService.decide(businessId);
  }

  @Post('decision/review')
  @HttpCode(HttpStatus.CREATED)
  async review(
    @Param('tenantId') tenantId: string,
    @Param('businessId') businessId: string,
    @Body() dto: AdminReviewBusinessDecisionDto,
    @CurrentAdmin() admin: CurrentAdminInfo,
  ): Promise<BusinessDecision> {
    await this.businessesService.getForTenantOrThrow(tenantId, businessId);
    return this.businessDecisionsService.review(businessId, {
      status: dto.status,
      reviewerId: admin.email,
      notes: dto.notes,
    });
  }
}
