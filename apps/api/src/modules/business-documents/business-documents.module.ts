import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { DocumentsModule } from '../documents/documents.module';
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
    BullModule.registerQueue({ name: BUSINESS_DOCUMENT_EXTRACTION_QUEUE_NAME }),
  ],
  controllers: [BusinessDocumentsController],
  providers: [
    BusinessDocumentsService,
    BusinessDocumentExtractionQueue,
    BusinessDocumentExtractionProcessor,
  ],
  exports: [BusinessDocumentsService],
})
export class BusinessDocumentsModule {}
