import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import type { DocumentType } from '@prisma/client';
import { fromBuffer as fileTypeFromBuffer } from 'file-type';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10MB

// Type-aware: SELFIE is image-only — nobody uploads a PDF of a live photo,
// and rasterizing one would just be new attack surface for no real use
// case. PASSPORT/BIRTH_CERTIFICATE accept scanned PDFs, per Phase 1.
const ALLOWED_MIME_TYPES_BY_TYPE: Record<DocumentType, Set<string>> = {
  PASSPORT: new Set(['image/jpeg', 'image/png', 'application/pdf']),
  BIRTH_CERTIFICATE: new Set(['image/jpeg', 'image/png', 'application/pdf']),
  SELFIE: new Set(['image/jpeg', 'image/png']),
};

export interface ValidatedFile {
  mimeType: string;
  sha256: string;
}

/**
 * Validates an uploaded document file against its *actual* content, not the
 * client-supplied Content-Type header (which is trivially spoofable) —
 * sniffs the real file type from magic bytes via `file-type`. Rejects
 * undecodable/mismatched files early, before any OCR/biometric time is
 * spent on them.
 */
export async function validateDocumentFile(
  buffer: Buffer,
  type: DocumentType,
): Promise<ValidatedFile> {
  if (buffer.length === 0) {
    throw new BadRequestException('Uploaded file is empty');
  }
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    throw new BadRequestException(
      `Uploaded file exceeds the ${MAX_DOCUMENT_BYTES / (1024 * 1024)}MB size limit`,
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
