import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Applicant } from '@prisma/client';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { ApplicantsService } from './applicants.service';
import { CreateApplicantDto } from './dto/create-applicant.dto';
import { ListApplicantsDto } from './dto/list-applicants.dto';

@ApiTags('applicants')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('v1/applicants')
export class ApplicantsController {
  constructor(private readonly applicantsService: ApplicantsService) {}

  @Post()
  create(@Body() dto: CreateApplicantDto): Promise<Applicant> {
    return this.applicantsService.create(dto);
  }

  @Get()
  list(@Query() query: ListApplicantsDto): Promise<Applicant[]> {
    return this.applicantsService.list(query.decisionStatus);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<Applicant> {
    return this.applicantsService.getOrThrow(id);
  }
}
