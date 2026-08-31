import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { BusinessDecision } from '@prisma/client';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { BusinessDecisionsService } from './business-decisions.service';
import { ReviewBusinessDecisionDto } from './dto/review-business-decision.dto';

@ApiTags('business-decisions')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('v1/businesses/:businessId')
export class BusinessDecisionsController {
  constructor(
    private readonly businessDecisionsService: BusinessDecisionsService,
  ) {}

  // 201, not 202 — synchronous computation, no queue (see the Phase 4 plan).
  @Post('decision')
  @HttpCode(HttpStatus.CREATED)
  decide(@Param('businessId') businessId: string): Promise<BusinessDecision> {
    return this.businessDecisionsService.decide(businessId);
  }

  @Get('decision')
  getLatest(
    @Param('businessId') businessId: string,
  ): Promise<BusinessDecision> {
    return this.businessDecisionsService.getLatestOrThrow(businessId);
  }

  @Post('decision/review')
  @HttpCode(HttpStatus.CREATED)
  review(
    @Param('businessId') businessId: string,
    @Body() dto: ReviewBusinessDecisionDto,
  ): Promise<BusinessDecision> {
    return this.businessDecisionsService.review(businessId, dto);
  }
}
