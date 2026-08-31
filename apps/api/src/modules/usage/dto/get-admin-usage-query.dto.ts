import { ApiKeyEnvironment } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';

// Admin-facing — unlike GetUsageQueryDto, this DOES accept an environment
// filter: admin mode bypasses the tenant-scoping extension entirely, so an
// admin can legitimately ask for either a tenant's LIVE or TEST usage.
// Defaults to LIVE in the service if omitted — a bank's TEST-key
// integration activity should never silently count toward billing.
export class GetAdminUsageQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsEnum(ApiKeyEnvironment)
  environment?: ApiKeyEnvironment;
}
