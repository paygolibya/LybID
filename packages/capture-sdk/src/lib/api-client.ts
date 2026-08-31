// Thin fetch wrapper for /v1/applicant-session/* only — this SDK never
// touches any other route (no API key, ever reaches the browser; see the
// applicant-session backend plan). `apiBaseUrl` is never hardcoded — this
// is a self-hosted platform, an integrator points this at their own
// LybID instance.

export type DocumentType = 'PASSPORT' | 'BIRTH_CERTIFICATE' | 'SELFIE';
export type DocumentStatus =
  | 'UPLOADED'
  | 'PROCESSING'
  | 'EXTRACTED'
  | 'FAILED'
  | 'NEEDS_REVIEW';
export type BiometricCheckStatus =
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'NEEDS_REVIEW';

export interface DocumentResource {
  id: string;
  applicantId: string;
  type: DocumentType;
  status: DocumentStatus;
}

export interface BiometricCheckResource {
  id: string;
  applicantId: string;
  status: BiometricCheckStatus;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly sessionToken: string,
  ) {}

  async uploadDocument(
    type: DocumentType,
    file: Blob,
    filename: string,
  ): Promise<DocumentResource> {
    const form = new FormData();
    form.append('type', type);
    form.append('file', file, filename);
    return this.request<DocumentResource>('/v1/applicant-session/documents', {
      method: 'POST',
      body: form,
    });
  }

  async getDocument(id: string): Promise<DocumentResource> {
    return this.request<DocumentResource>(
      `/v1/applicant-session/documents/${id}`,
    );
  }

  async createBiometricCheck(
    selfieDocumentId: string,
  ): Promise<BiometricCheckResource> {
    return this.request<BiometricCheckResource>(
      '/v1/applicant-session/biometric-checks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selfieDocumentId }),
      },
    );
  }

  async getBiometricCheck(id: string): Promise<BiometricCheckResource> {
    return this.request<BiometricCheckResource>(
      `/v1/applicant-session/biometric-checks/${id}`,
    );
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${this.sessionToken}`,
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ApiError(
        `Request to ${path} failed with status ${response.status}: ${body}`,
        response.status,
      );
    }
    return (await response.json()) as T;
  }
}

export const DOCUMENT_TERMINAL_STATUSES: ReadonlySet<DocumentStatus> = new Set(
  ['EXTRACTED', 'FAILED', 'NEEDS_REVIEW'],
);
export const BIOMETRIC_TERMINAL_STATUSES: ReadonlySet<BiometricCheckStatus> =
  new Set(['COMPLETED', 'FAILED', 'NEEDS_REVIEW']);

/** Polls `check` until it returns a terminal resource or the timeout elapses. */
export async function pollUntilTerminal<
  T extends { status: DocumentStatus | BiometricCheckStatus },
>(
  check: () => Promise<T>,
  isTerminal: (status: T['status']) => boolean,
  { timeoutMs = 60_000, intervalMs = 1500 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (isTerminal(result.status)) return result;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for a terminal status`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
