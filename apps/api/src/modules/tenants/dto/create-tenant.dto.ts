import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message:
      'slug must be lowercase alphanumeric with single hyphens (e.g. "bank-of-tripoli")',
  })
  @MinLength(2)
  @MaxLength(100)
  slug!: string;
}
