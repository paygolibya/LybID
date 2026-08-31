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
import type { Business } from '@prisma/client';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { BusinessesService } from './businesses.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { ListBusinessesDto } from './dto/list-businesses.dto';

@ApiTags('businesses')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('v1/businesses')
export class BusinessesController {
  constructor(private readonly businessesService: BusinessesService) {}

  @Post()
  create(@Body() dto: CreateBusinessDto): Promise<Business> {
    return this.businessesService.create(dto);
  }

  @Get()
  list(@Query() query: ListBusinessesDto): Promise<Business[]> {
    return this.businessesService.list(query.decisionStatus);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<Business> {
    return this.businessesService.getOrThrow(id);
  }
}
