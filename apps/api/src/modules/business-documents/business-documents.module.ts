import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { DocumentsModule } from '../documents/documents.module';
import { UsageModule } from '../usage/usage.module';
import { AdminBusinessDocumentsController } from './admin-business-documents.controller';
import { BusinessDocumentsController } from './business-documents.controller';
import { BusinessDocumentsService } from './business-documents.service';
import {
  BUSINESS_DOCUMENT_EXTRACTION_QUEUE_NAME,
  BusinessDocumentExtractionQueue,
} from './queue/business-document-extraction.queue';
import { BusinessDocumentExtractionProcessor } from './queue/business-document-extraction.processor';

@Module({
  imports: [
    BusinessesModule,
    // Reuses StorageService and OcrClientService rather than duplicating
    // them — same precedent BiometricChecksModule set in Phase 2 (importing
    // DocumentsModule for StorageService reuse).
    DocumentsModule,
    // Not re-exported transitively through DocumentsModule (it imports
    // UsageModule for its own use but doesn't re-export UsageService) —
    // imported directly here too.
    UsageModule,
    BullModule.registerQueue({ name: BUSINESS_DOCUMENT_EXTRACTION_QUEUE_NAME }),
  ],
  controllers: [BusinessDocumentsController, AdminBusinessDocumentsController],
  providers: [
    BusinessDocumentsService,
    BusinessDocumentExtractionQueue,
    BusinessDocumentExtractionProcessor,
  ],
  exports: [BusinessDocumentsService],
})
export class BusinessDocumentsModule {}
