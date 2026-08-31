import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { Env } from '../../config/env.validation';
import { ApplicantsModule } from '../applicants/applicants.module';
import { ApplicantJwtStrategy } from './applicant-jwt.strategy';
import { ApplicantTokensController } from './applicant-tokens.controller';
import { ApplicantTokensService } from './applicant-tokens.service';

@Module({
  imports: [
    ApplicantsModule,
    PassportModule,
    // Own registration, own secret — deliberately independent from
    // AdminAuthModule's JwtModule (which isn't exported/global anyway).
    // See the applicant-session plan for why a separate secret matters.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('APPLICANT_TOKEN_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('APPLICANT_TOKEN_EXPIRES_IN', {
            infer: true,
          }),
        },
      }),
    }),
  ],
  controllers: [ApplicantTokensController],
  providers: [ApplicantTokensService, ApplicantJwtStrategy],
})
export class ApplicantTokensModule {}
