import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Applicant } from '@prisma/client';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { ApplicantsService } from './applicants.service';
import { CreateApplicantDto } from './dto/create-applicant.dto';

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
  list(): Promise<Applicant[]> {
    return this.applicantsService.list();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<Applicant> {
    return this.applicantsService.getOrThrow(id);
  }
}
