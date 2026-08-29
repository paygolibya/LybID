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
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { ApiKeysService, IssuedApiKey, PublicApiKey } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

@ApiTags('admin-api-keys')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@Controller('admin')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post('tenants/:tenantId/api-keys')
  issue(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateApiKeyDto,
  ): Promise<IssuedApiKey> {
    return this.apiKeysService.issue(tenantId, dto);
  }

  @Get('tenants/:tenantId/api-keys')
  list(@Param('tenantId') tenantId: string): Promise<PublicApiKey[]> {
    return this.apiKeysService.listForTenant(tenantId);
  }

  @Patch('api-keys/:id/revoke')
  revoke(@Param('id') id: string): Promise<PublicApiKey> {
    return this.apiKeysService.revoke(id);
  }
}
