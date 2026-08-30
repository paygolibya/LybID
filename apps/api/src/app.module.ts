import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestTransactionInterceptor } from './common/interceptors/request-transaction.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { AdminAuthModule } from './modules/admin-auth/admin-auth.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { ApplicantsModule } from './modules/applicants/applicants.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { BiometricChecksModule } from './modules/biometric-checks/biometric-checks.module';
import { BusinessDocumentsModule } from './modules/business-documents/business-documents.module';
import { BusinessesModule } from './modules/businesses/businesses.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { HealthModule } from './modules/health/health.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { WhoamiModule } from './modules/whoami/whoami.module';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
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
    WhoamiModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestTransactionInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
