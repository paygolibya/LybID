import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthService } from './admin-auth.service';
import { LoginDto } from './dto/login.dto';

@ApiTags('admin-auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  // The one truly public, credential-guessable endpoint in this system —
  // every other route needs a secret you can only get from Marsa or a
  // tenant first. Overrides the app-wide default (100/min) with a much
  // stricter limit, on top of the login-attempt audit logging in
  // AdminAuthService (see its own comment).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  login(@Body() dto: LoginDto): Promise<{ accessToken: string }> {
    return this.adminAuthService.login(dto.email, dto.password);
  }
}
