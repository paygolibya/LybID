import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Business } from '@prisma/client';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import type { AdminBusinessDetail } from './businesses.service';
import { BusinessesService } from './businesses.service';
import { ListBusinessesDto } from './dto/list-businesses.dto';

// Mirrors AdminApplicantsController exactly, for Business.
@ApiTags('admin-businesses')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@Controller('admin/tenants/:tenantId/businesses')
export class AdminBusinessesController {
  constructor(private readonly businessesService: BusinessesService) {}

  @Get()
  list(
    @Param('tenantId') tenantId: string,
    @Query() query: ListBusinessesDto,
  ): Promise<Business[]> {
    return this.businessesService.listForTenant(tenantId, query.decisionStatus);
  }

  @Get(':id')
  getDetail(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
  ): Promise<AdminBusinessDetail> {
    return this.businessesService.getDetailForTenant(tenantId, id);
  }
}
