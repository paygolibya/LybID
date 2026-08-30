import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.validation';

export interface FaceMatchResult {
  score: number | null;
  verdict: 'MATCH' | 'NO_MATCH' | 'UNKNOWN';
  reason?: string;
}

export interface LivenessResult {
  score: number | null;
  verdict: 'LIVE' | 'SPOOF' | 'UNKNOWN';
  reason?: string;
}

export interface BiometricVerifyResult {
  faceMatch: FaceMatchResult;
  liveness: LivenessResult;
  engine: string;
  rawResult: Record<string, unknown>;
}

/**
 * HTTP client for the biometrics sidecar (services/biometrics) — same
 * pattern as OcrClientService: plain internal REST, multipart file upload,
 * stateless compute service on the other end (image in, structured JSON
 * out, no DB/tenant awareness — see the Phase 2 plan for why that split is
 * deliberate, same reasoning as Phase 1's OCR sidecar).
 */
@Injectable()
export class BiometricsClientService {
  private readonly logger = new Logger(BiometricsClientService.name);
  private readonly baseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get('BIOMETRICS_SERVICE_URL', { infer: true });
  }

  async verify(
    referenceBuffer: Buffer,
    referenceMimeType: string,
    referenceFilename: string,
    selfieBuffer: Buffer,
    selfieMimeType: string,
    selfieFilename: string,
  ): Promise<BiometricVerifyResult> {
    const form = new FormData();
    // Buffer vs BlobPart is a TS lib-typing gap (Node's Buffer type is
    // ArrayBufferLike, BlobPart wants ArrayBuffer specifically) — Buffer is
    // a valid BlobPart at runtime, hence the cast (same as OcrClientService).
    form.append(
      'reference_image',
      new Blob([referenceBuffer as unknown as BlobPart], {
        type: referenceMimeType,
      }),
      referenceFilename,
    );
    form.append(
      'selfie_image',
      new Blob([selfieBuffer as unknown as BlobPart], { type: selfieMimeType }),
      selfieFilename,
    );

    const response = await fetch(`${this.baseUrl}/verify`, {
      method: 'POST',
      body: form,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.error(
        `Biometrics sidecar returned ${response.status}: ${body}`,
      );
      throw new Error(
        `Biometric verification failed with status ${response.status}`,
      );
    }

    return (await response.json()) as BiometricVerifyResult;
  }
}
