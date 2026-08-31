import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Business } from '@prisma/client';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { BusinessesService } from '../businesses/businesses.service';
import { BusinessErasureService } from './business-erasure.service';

// Mirrors AdminApplicantErasureController exactly, for Business.
@ApiTags('admin-business-erasure')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@Controller('admin/tenants/:tenantId/businesses/:id')
export class AdminBusinessErasureController {
  constructor(
    private readonly businessesService: BusinessesService,
    private readonly businessErasureService: BusinessErasureService,
  ) {}

  @Post('erase')
  @HttpCode(HttpStatus.OK)
  async erase(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
  ): Promise<Business> {
    await this.businessesService.getForTenantOrThrow(tenantId, id);
    return this.businessErasureService.erase(id);
  }
}
