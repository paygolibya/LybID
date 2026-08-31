import { IsDateString, IsOptional } from 'class-validator';

// Tenant-facing only — deliberately NO environment field. Which
// environment a tenant sees is already fixed by which key they
// authenticated with (LIVE or TEST) and enforced by the tenant-scoping
// Prisma extension itself: a LIVE-authenticated request explicitly
// filtering for TEST data is a scoping violation, not a valid query. See
// GetAdminUsageQueryDto for the admin-only environment filter (admin mode
// bypasses that scoping, so it can legitimately ask for either).
export class GetUsageQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
