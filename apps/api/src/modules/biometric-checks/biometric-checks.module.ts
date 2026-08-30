import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ApplicantsModule } from '../applicants/applicants.module';
import { DocumentsModule } from '../documents/documents.module';
import { BiometricChecksController } from './biometric-checks.controller';
import { BiometricChecksService } from './biometric-checks.service';
import { BiometricsClientService } from './biometrics-client/biometrics-client.service';
import {
  BIOMETRIC_CHECK_QUEUE_NAME,
  BiometricCheckQueue,
} from './queue/biometric-check.queue';
import { BiometricCheckProcessor } from './queue/biometric-check.processor';

@Module({
  imports: [
    ApplicantsModule,
    DocumentsModule, // for StorageService (re-fetching selfie/reference files in the worker)
    BullModule.registerQueue({ name: BIOMETRIC_CHECK_QUEUE_NAME }),
  ],
  controllers: [BiometricChecksController],
  providers: [
    BiometricChecksService,
    BiometricCheckQueue,
    BiometricCheckProcessor,
    BiometricsClientService,
  ],
  exports: [BiometricChecksService],
})
export class BiometricChecksModule {}
