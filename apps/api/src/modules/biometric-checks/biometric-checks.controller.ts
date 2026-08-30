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
import type { BiometricCheck } from '@prisma/client';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import {
  CurrentTenant,
  CurrentTenantInfo,
} from '../../common/decorators/current-tenant.decorator';
import { BiometricChecksService } from './biometric-checks.service';
import { CreateBiometricCheckDto } from './dto/create-biometric-check.dto';

@ApiTags('biometric-checks')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('v1')
export class BiometricChecksController {
  constructor(
    private readonly biometricChecksService: BiometricChecksService,
  ) {}

  @Post('applicants/:applicantId/biometric-checks')
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @Param('applicantId') applicantId: string,
    @Body() dto: CreateBiometricCheckDto,
    @CurrentTenant() tenant: CurrentTenantInfo,
  ): Promise<BiometricCheck> {
    return this.biometricChecksService.create({
      ...dto,
      applicantId,
      apiKeyId: tenant.apiKeyId,
    });
  }

  @Get('biometric-checks/:id')
  get(@Param('id') id: string): Promise<BiometricCheck> {
    return this.biometricChecksService.getOrThrow(id);
  }
}
