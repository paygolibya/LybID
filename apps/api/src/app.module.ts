import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestTransactionInterceptor } from './common/interceptors/request-transaction.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { AdminAuthModule } from './modules/admin-auth/admin-auth.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { ApplicantDecisionsModule } from './modules/applicant-decisions/applicant-decisions.module';
import { ApplicantErasureModule } from './modules/applicant-erasure/applicant-erasure.module';
import { ApplicantSessionModule } from './modules/applicant-session/applicant-session.module';
import { ApplicantTokensModule } from './modules/applicant-tokens/applicant-tokens.module';
import { ApplicantsModule } from './modules/applicants/applicants.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { BiometricChecksModule } from './modules/biometric-checks/biometric-checks.module';
import { BusinessDecisionsModule } from './modules/business-decisions/business-decisions.module';
import { BusinessDocumentsModule } from './modules/business-documents/business-documents.module';
import { BusinessErasureModule } from './modules/business-erasure/business-erasure.module';
import { BusinessesModule } from './modules/businesses/businesses.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { HealthModule } from './modules/health/health.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsageModule } from './modules/usage/usage.module';
import { WhoamiModule } from './modules/whoami/whoami.module';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Phase 8: a moderate global default (no rate limiting existed
    // anywhere in this system before). In-memory storage — fine for this
    // platform's typical single-instance-per-bank deployment shape; a
    // multi-instance deployment would need a shared (e.g. Redis-backed)
    // store, not built here. AdminAuthController overrides this with a
    // much stricter limit on the one truly public, credential-guessable
    // endpoint in the system — see its own @Throttle().
    //
    // skipIf outside production: found the hard way — the e2e suite's own
    // test-app helper logs in as admin fresh in almost every test's
    // beforeEach (loginAsTestAdmin()), and the whole 75-test suite runs in
    // well under a minute against one shared app instance, so a real
    // production-appropriate login limit (5/min) started 429ing the test
    // suite itself, not an attacker. Throttling is a live-deployment
    // concern; it staying off outside NODE_ENV=production doesn't weaken
    // any real guarantee, and the mechanism itself is still verified by a
    // dedicated e2e test that forces NODE_ENV=production for one isolated
    // app instance (see admin-auth-throttling.e2e-spec.ts).
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
      skipIf: () => process.env.NODE_ENV !== 'production',
    }),
    DatabaseModule,
    QueueModule,
    AuditLogModule,
    HealthModule,
    AdminAuthModule,
    TenantsModule,
    ApiKeysModule,
    ApplicantsModule,
    DocumentsModule,
    BiometricChecksModule,
    BusinessesModule,
    BusinessDocumentsModule,
    ApplicantDecisionsModule,
    BusinessDecisionsModule,
    ApplicantErasureModule,
    BusinessErasureModule,
    UsageModule,
    ApplicantTokensModule,
    ApplicantSessionModule,
    WhoamiModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestTransactionInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
