import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.validation';
import type { DocumentType } from '@prisma/client';

export interface ExtractedField {
  name: string;
  value: string;
  confidence: number;
}

export interface OcrExtractionResult {
  rawText: string;
  fields: ExtractedField[];
  overallConfidence: number;
}

/**
 * HTTP client for the OCR sidecar (services/ocr) — plain internal REST,
 * multipart file upload (not base64-in-JSON; scanned documents are
 * multi-MB). The sidecar is a stateless compute service: image in,
 * structured JSON out, no DB/tenant awareness — see the Phase 1 plan for
 * why that split is deliberate.
 */
@Injectable()
export class OcrClientService {
  private readonly logger = new Logger(OcrClientService.name);
  private readonly baseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get('OCR_SERVICE_URL', { infer: true });
  }

  async extract(
    documentType: DocumentType,
    fileBuffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<OcrExtractionResult> {
    const form = new FormData();
    form.append('document_type', documentType);
    // Buffer vs BlobPart is a TS lib-typing gap (Node's Buffer type is
    // ArrayBufferLike, BlobPart wants ArrayBuffer specifically) — Buffer is
    // a valid BlobPart at runtime, hence the cast.
    form.append(
      'file',
      new Blob([fileBuffer as unknown as BlobPart], { type: mimeType }),
      filename,
    );

    const response = await fetch(`${this.baseUrl}/extract`, {
      method: 'POST',
      body: form,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.error(`OCR sidecar returned ${response.status}: ${body}`);
      throw new Error(`OCR extraction failed with status ${response.status}`);
    }

    return (await response.json()) as OcrExtractionResult;
  }
}
