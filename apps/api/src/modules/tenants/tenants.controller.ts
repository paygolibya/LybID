import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Tenant } from '@prisma/client';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantsService } from './tenants.service';

@ApiTags('admin-tenants')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@Controller('admin/tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  create(@Body() dto: CreateTenantDto): Promise<Tenant> {
    return this.tenantsService.create(dto);
  }

  @Get()
  list(): Promise<Tenant[]> {
    return this.tenantsService.list();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<Tenant> {
    return this.tenantsService.getOrThrow(id);
  }

  @Patch(':id/suspend')
  suspend(@Param('id') id: string): Promise<Tenant> {
    return this.tenantsService.setStatus(id, 'SUSPENDED');
  }

  @Patch(':id/activate')
  activate(@Param('id') id: string): Promise<Tenant> {
    return this.tenantsService.setStatus(id, 'ACTIVE');
  }
}
