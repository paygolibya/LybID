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
import type { ApplicantDecision } from '@prisma/client';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { ApplicantDecisionsService } from './applicant-decisions.service';
import { ReviewApplicantDecisionDto } from './dto/review-applicant-decision.dto';

@ApiTags('applicant-decisions')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('v1/applicants/:applicantId')
export class ApplicantDecisionsController {
  constructor(
    private readonly applicantDecisionsService: ApplicantDecisionsService,
  ) {}

  // 201, not 202 — this is synchronous computation, no queue involved (see
  // the Phase 4 plan for why this phase has no async worker at all).
  @Post('decision')
  @HttpCode(HttpStatus.CREATED)
  decide(
    @Param('applicantId') applicantId: string,
  ): Promise<ApplicantDecision> {
    return this.applicantDecisionsService.decide(applicantId);
  }

  @Get('decision')
  getLatest(
    @Param('applicantId') applicantId: string,
  ): Promise<ApplicantDecision> {
    return this.applicantDecisionsService.getLatestOrThrow(applicantId);
  }

  @Post('decision/review')
  @HttpCode(HttpStatus.CREATED)
  review(
    @Param('applicantId') applicantId: string,
    @Body() dto: ReviewApplicantDecisionDto,
  ): Promise<ApplicantDecision> {
    return this.applicantDecisionsService.review(applicantId, dto);
  }
}
