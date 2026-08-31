// Thin fetch wrapper for the /admin/* routes this dashboard is the only
// consumer of. Mirrors @lybid/capture-sdk's api-client.ts in spirit (a
// small typed wrapper, no heavier HTTP library) but talks to a completely
// different route tree with a different auth scheme (admin JWT, not a
// session token).

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  tenantId: string;
  environment: 'LIVE' | 'TEST';
  status: 'ACTIVE' | 'REVOKED';
  keyPrefix: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface IssuedApiKey extends ApiKey {
  token: string;
}

export interface UsageSummary {
  from: string;
  to: string;
  environment: 'LIVE' | 'TEST';
  counts: Record<string, number>;
  total: number;
}

export type DecisionStatus = 'APPROVED' | 'REJECTED' | 'NEEDS_REVIEW';

export interface Applicant {
  id: string;
  externalId: string | null;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  status: string;
  latestDecisionStatus: DecisionStatus | null;
  createdAt: string;
}

export interface Business {
  id: string;
  externalId: string | null;
  legalName: string | null;
  commercialRegistrationNumber: string | null;
  status: string;
  latestDecisionStatus: DecisionStatus | null;
  createdAt: string;
}

export interface DocumentExtraction {
  id: string;
  engine: string;
  rawText: string | null;
  fields: { name: string; value: string; confidence: number }[] | null;
  overallConfidence: number | null;
  status: 'COMPLETED' | 'FAILED';
  createdAt: string;
}

export interface AdminDocument {
  id: string;
  type: string;
  status: string;
  originalFilename: string;
  mimeType: string;
  uploadedAt: string;
  extractions: DocumentExtraction[];
}

export interface BiometricCheck {
  id: string;
  status: string;
  livenessScore: number | null;
  livenessVerdict: string | null;
  faceMatchScore: number | null;
  faceMatchVerdict: string | null;
  selfieDocumentId: string;
  referenceDocumentId: string;
  createdAt: string;
}

export interface Decision {
  id: string;
  status: DecisionStatus;
  reasoning: Record<string, unknown>;
  reviewerId: string | null;
  reviewNotes: string | null;
  createdAt: string;
}

export interface ApplicantDetail extends Applicant {
  documents: AdminDocument[];
  biometricChecks: BiometricCheck[];
  decisions: Decision[];
}

export interface BusinessDetail extends Business {
  documents: AdminDocument[];
  decisions: Decision[];
}

// Build-time API origin — this dashboard is deployed alongside one specific
// self-hosted LybID instance (see the root README's self-hosted-deployment
// framing), so this is a build-time env var, not a runtime setting.
const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  'http://localhost:3000';

export class ApiClient {
  constructor(private readonly getToken: () => string | null) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new ApiError(res.status, body.message ?? `Request failed (${res.status})`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  login(email: string, password: string): Promise<{ accessToken: string }> {
    return this.request('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  listTenants(): Promise<Tenant[]> {
    return this.request('/admin/tenants');
  }

  getTenant(id: string): Promise<Tenant> {
    return this.request(`/admin/tenants/${id}`);
  }

  createTenant(input: { name: string; slug: string }): Promise<Tenant> {
    return this.request('/admin/tenants', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  suspendTenant(id: string): Promise<Tenant> {
    return this.request(`/admin/tenants/${id}/suspend`, { method: 'PATCH' });
  }

  activateTenant(id: string): Promise<Tenant> {
    return this.request(`/admin/tenants/${id}/activate`, { method: 'PATCH' });
  }

  listApiKeys(tenantId: string): Promise<ApiKey[]> {
    return this.request(`/admin/tenants/${tenantId}/api-keys`);
  }

  issueApiKey(
    tenantId: string,
    input: { environment: 'LIVE' | 'TEST'; expiresAt?: string },
  ): Promise<IssuedApiKey> {
    return this.request(`/admin/tenants/${tenantId}/api-keys`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  revokeApiKey(id: string): Promise<ApiKey> {
    return this.request(`/admin/api-keys/${id}/revoke`, { method: 'PATCH' });
  }

  getUsage(
    tenantId: string,
    query: { environment?: 'LIVE' | 'TEST'; from?: string; to?: string } = {},
  ): Promise<UsageSummary> {
    const params = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v) as [string, string][],
    );
    const qs = params.toString();
    return this.request(`/admin/tenants/${tenantId}/usage${qs ? `?${qs}` : ''}`);
  }

  listApplicants(
    tenantId: string,
    decisionStatus?: DecisionStatus,
  ): Promise<Applicant[]> {
    const qs = decisionStatus ? `?decisionStatus=${decisionStatus}` : '';
    return this.request(`/admin/tenants/${tenantId}/applicants${qs}`);
  }

  getApplicantDetail(tenantId: string, id: string): Promise<ApplicantDetail> {
    return this.request(`/admin/tenants/${tenantId}/applicants/${id}`);
  }

  decideApplicant(tenantId: string, id: string): Promise<Decision> {
    return this.request(
      `/admin/tenants/${tenantId}/applicants/${id}/decision`,
      { method: 'POST' },
    );
  }

  reviewApplicant(
    tenantId: string,
    id: string,
    input: { status: 'APPROVED' | 'REJECTED'; notes?: string },
  ): Promise<Decision> {
    return this.request(
      `/admin/tenants/${tenantId}/applicants/${id}/decision/review`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  listBusinesses(
    tenantId: string,
    decisionStatus?: DecisionStatus,
  ): Promise<Business[]> {
    const qs = decisionStatus ? `?decisionStatus=${decisionStatus}` : '';
    return this.request(`/admin/tenants/${tenantId}/businesses${qs}`);
  }

  getBusinessDetail(tenantId: string, id: string): Promise<BusinessDetail> {
    return this.request(`/admin/tenants/${tenantId}/businesses/${id}`);
  }

  decideBusiness(tenantId: string, id: string): Promise<Decision> {
    return this.request(
      `/admin/tenants/${tenantId}/businesses/${id}/decision`,
      { method: 'POST' },
    );
  }

  reviewBusiness(
    tenantId: string,
    id: string,
    input: { status: 'APPROVED' | 'REJECTED'; notes?: string },
  ): Promise<Decision> {
    return this.request(
      `/admin/tenants/${tenantId}/businesses/${id}/decision/review`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  /**
   * Fetches a document image as an authenticated blob, not a bare URL — a
   * plain `<img src>` can't carry an Authorization header, and putting the
   * admin JWT in the URL as a query param would recreate exactly the
   * bearer-URL-in-history problem the backend-proxied-stream decision was
   * meant to avoid. Callers turn the blob into an object URL (see
   * AuthenticatedImage) and revoke it on unmount.
   */
  async getDocumentImageBlob(tenantId: string, documentId: string): Promise<Blob> {
    const token = this.getToken();
    const res = await fetch(
      `${API_BASE_URL}/admin/tenants/${tenantId}/documents/${documentId}/image`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!res.ok) throw new ApiError(res.status, `Failed to load image (${res.status})`);
    return res.blob();
  }

  async getBusinessDocumentImageBlob(
    tenantId: string,
    documentId: string,
  ): Promise<Blob> {
    const token = this.getToken();
    const res = await fetch(
      `${API_BASE_URL}/admin/tenants/${tenantId}/business-documents/${documentId}/image`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!res.ok) throw new ApiError(res.status, `Failed to load image (${res.status})`);
    return res.blob();
  }
}
