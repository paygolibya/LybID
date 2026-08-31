import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Business } from '@prisma/client';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { BusinessErasureService } from './business-erasure.service';

// Mirrors ApplicantErasureController exactly, for Business.
@ApiTags('business-erasure')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('v1/businesses/:id')
export class BusinessErasureController {
  constructor(
    private readonly businessErasureService: BusinessErasureService,
  ) {}

  @Post('erase')
  @HttpCode(HttpStatus.OK)
  erase(@Param('id') id: string): Promise<Business> {
    return this.businessErasureService.erase(id);
  }
}
