import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import type { BusinessDocumentType } from '@prisma/client';
import { fromBuffer as fileTypeFromBuffer } from 'file-type';

export const MAX_BUSINESS_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10MB — same limit as documents/file-validation.util.ts

// All three KYB document types accept scanned PDFs as well as images, same
// as PASSPORT/BIRTH_CERTIFICATE in documents/file-validation.util.ts —
// these are all real-world scanned government/business paperwork.
const ALLOWED_MIME_TYPES_BY_TYPE: Record<BusinessDocumentType, Set<string>> = {
  COMMERCIAL_REGISTRATION: new Set([
    'image/jpeg',
    'image/png',
    'application/pdf',
  ]),
  CHAMBER_OF_COMMERCE: new Set(['image/jpeg', 'image/png', 'application/pdf']),
  TAX_ID: new Set(['image/jpeg', 'image/png', 'application/pdf']),
};

export interface ValidatedBusinessFile {
  mimeType: string;
  sha256: string;
}

/**
 * Validates an uploaded business document file against its *actual*
 * content, not the client-supplied Content-Type header (trivially
 * spoofable) — mirrors documents/file-validation.util.ts's
 * validateDocumentFile exactly, for BusinessDocumentType instead of
 * DocumentType.
 */
export async function validateBusinessDocumentFile(
  buffer: Buffer,
  type: BusinessDocumentType,
): Promise<ValidatedBusinessFile> {
  if (buffer.length === 0) {
    throw new BadRequestException('Uploaded file is empty');
  }
  if (buffer.length > MAX_BUSINESS_DOCUMENT_BYTES) {
    throw new BadRequestException(
      `Uploaded file exceeds the ${MAX_BUSINESS_DOCUMENT_BYTES / (1024 * 1024)}MB size limit`,
    );
  }

  const allowed = ALLOWED_MIME_TYPES_BY_TYPE[type];
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !allowed.has(detected.mime)) {
    throw new BadRequestException(
      `Uploaded file is not a recognized type for ${type} (checked by file content, not filename/header) — allowed: ${[...allowed].join(', ')}`,
    );
  }

  const sha256 = createHash('sha256').update(buffer).digest('hex');
  return { mimeType: detected.mime, sha256 };
}
