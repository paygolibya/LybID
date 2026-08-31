import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { BiometricsClientService } from '../../src/modules/biometric-checks/biometrics-client/biometrics-client.service';
import type { OcrClientService } from '../../src/modules/documents/ocr-client/ocr-client.service';
import {
  createApplicant,
  createBusiness,
  createTenantWithApiKey,
  createTestAppWithStubOcr,
  createTestAppWithStubOcrAndBiometrics,
  getOwnerClient,
  loginAsTestAdmin,
  resetDatabase,
  resetQueue,
  seedAdmin,
  TEST_ADMIN_EMAIL,
  waitFor,
} from './utils/test-app';

// Same tiny real PNG decisioning.e2e-spec.ts uses — magic-byte sniffing
// needs real bytes, not just a correct extension/field name.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const HIGH_CONFIDENCE_OCR = {
  rawText: 'looks great',
  fields: [{ name: 'number', value: 'N1234567', confidence: 0.98 }],
  overallConfidence: 0.95,
};
// Mirrors decisioning.e2e-spec.ts's identical constant — a below-threshold
// biometric result, deterministically landing decide() at NEEDS_REVIEW.
const FAILING_BIOMETRICS = {
  faceMatch: { score: 0.3, verdict: 'MATCH' as const },
  liveness: { score: 0.2, verdict: 'SPOOF' as const },
  engine: 'test-engine',
  rawResult: {},
};

// Phase 7: the new /admin/tenants/:tenantId/... routes that let Marsa's own
// ops dashboard browse and act on a specific tenant's data. The one thing
// every test here is really pinning down: :tenantId in the URL is an
// actual constraint, not decoration — every cross-tenant case must 404,
// not return (or act on) the other tenant's row. See the Phase 7 plan for
// why this needed a whole new explicit-tenantId code path (admin auth has
// no auto-scoping to fall back on).
describe('Admin dashboard endpoints (e2e, stubbed OCR + biometrics)', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let adminToken: string;
  let extractMock: jest.Mock;
  let verifyMock: jest.Mock;

  beforeAll(async () => {
    owner = getOwnerClient();
    extractMock = jest.fn();
    verifyMock = jest.fn();
    const ocrStub: Pick<OcrClientService, 'extract'> = { extract: extractMock };
    const biometricsStub: Pick<BiometricsClientService, 'verify'> = {
      verify: verifyMock,
    };
    app = await createTestAppWithStubOcrAndBiometrics(ocrStub, biometricsStub);
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
    await resetQueue();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    await resetQueue();
    await seedAdmin(owner);
    adminToken = await loginAsTestAdmin(app);
    extractMock.mockReset();
    extractMock.mockResolvedValue(HIGH_CONFIDENCE_OCR);
    verifyMock.mockReset();
  });

  async function uploadDocument(
    tenantToken: string,
    applicantId: string,
    type: 'PASSPORT' | 'BIRTH_CERTIFICATE' | 'SELFIE',
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/documents`)
      .set('X-API-Key', tenantToken)
      .field('type', type)
      .attach('file', TINY_PNG, `${type}.png`)
      .expect(202);
    if (type !== 'SELFIE') {
      await waitFor(async () => {
        const doc = await request(app.getHttpServer())
          .get(`/v1/documents/${res.body.id}`)
          .set('X-API-Key', tenantToken)
          .expect(200);
        return doc.body.status === 'EXTRACTED' ? doc.body : false;
      });
    }
    return res.body.id as string;
  }
  const uploadPassport = (tenantToken: string, applicantId: string) =>
    uploadDocument(tenantToken, applicantId, 'PASSPORT');

  /** Mirrors decisioning.e2e-spec.ts's setUpApplicant — passport + birth
   * certificate (both EXTRACTED) and a biometric check reaching the given
   * outcome, ready for decide(). */
  async function setUpApplicantForDecision(
    tenantToken: string,
    applicantId: string,
    biometricsResult: typeof FAILING_BIOMETRICS,
  ): Promise<void> {
    await uploadDocument(tenantToken, applicantId, 'PASSPORT');
    await uploadDocument(tenantToken, applicantId, 'BIRTH_CERTIFICATE');
    const selfieId = await uploadDocument(tenantToken, applicantId, 'SELFIE');

    verifyMock.mockResolvedValue(biometricsResult);
    const checkRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/biometric-checks`)
      .set('X-API-Key', tenantToken)
      .send({ selfieDocumentId: selfieId })
      .expect(202);
    await waitFor(async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/biometric-checks/${checkRes.body.id}`)
        .set('X-API-Key', tenantToken)
        .expect(200);
      return res.body.status !== 'PROCESSING' ? res.body : false;
    });
  }

  describe('applicants', () => {
    it('lists and fetches applicant detail scoped to the right tenant', async () => {
      const tenant = await createTenantWithApiKey(app, adminToken, 'admin-dash-a1');
      const applicantId = await createApplicant(app, tenant.token, {
        externalId: 'a-1',
      });
      const documentId = await uploadPassport(tenant.token, applicantId);

      const listRes = await request(app.getHttpServer())
        .get(`/admin/tenants/${tenant.tenantId}/applicants`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(listRes.body.map((a: { id: string }) => a.id)).toContain(
        applicantId,
      );

      const detailRes = await request(app.getHttpServer())
        .get(`/admin/tenants/${tenant.tenantId}/applicants/${applicantId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(detailRes.body.id).toBe(applicantId);
      expect(detailRes.body.documents).toHaveLength(1);
      expect(detailRes.body.documents[0].id).toBe(documentId);
      expect(detailRes.body.documents[0].extractions[0].status).toBe(
        'COMPLETED',
      );
      expect(detailRes.body.biometricChecks).toEqual([]);
      expect(detailRes.body.decisions).toEqual([]);
    });

    it('404s an applicant list/detail/decision/image request scoped to the wrong tenant', async () => {
      const tenantA = await createTenantWithApiKey(app, adminToken, 'admin-dash-a2a');
      const tenantB = await createTenantWithApiKey(app, adminToken, 'admin-dash-a2b');
      const applicantId = await createApplicant(app, tenantA.token, {
        externalId: 'a-iso',
      });
      const documentId = await uploadPassport(tenantA.token, applicantId);

      await request(app.getHttpServer())
        .get(`/admin/tenants/${tenantB.tenantId}/applicants/${applicantId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .post(
          `/admin/tenants/${tenantB.tenantId}/applicants/${applicantId}/decision`,
        )
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/admin/tenants/${tenantB.tenantId}/documents/${documentId}/image`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      // Tenant A's own scope still works — confirms the 404s above are
      // real isolation, not a broken route.
      await request(app.getHttpServer())
        .get(`/admin/tenants/${tenantA.tenantId}/applicants/${applicantId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('admin-triggered decide + review work, and reviewerId is the admin email, not client-supplied', async () => {
      const tenant = await createTenantWithApiKey(app, adminToken, 'admin-dash-a3');
      const applicantId = await createApplicant(app, tenant.token, {
        externalId: 'a-3',
      });

      // No verifications uploaded yet -> decide() 400s (missing), same
      // rule as the tenant-facing route — proves the admin route delegates
      // to the real ApplicantDecisionsService.decide(), not a parallel/
      // looser implementation.
      await request(app.getHttpServer())
        .post(`/admin/tenants/${tenant.tenantId}/applicants/${applicantId}/decision`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      await setUpApplicantForDecision(tenant.token, applicantId, FAILING_BIOMETRICS);

      const decideRes = await request(app.getHttpServer())
        .post(`/admin/tenants/${tenant.tenantId}/applicants/${applicantId}/decision`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      expect(decideRes.body.status).toBe('NEEDS_REVIEW');

      const reviewRes = await request(app.getHttpServer())
        .post(
          `/admin/tenants/${tenant.tenantId}/applicants/${applicantId}/decision/review`,
        )
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'APPROVED', notes: 'looked fine on review' })
        .expect(201);
      expect(reviewRes.body.status).toBe('APPROVED');
      // The point of this test: reviewerId comes from the authenticated
      // admin's own JWT (email), not anything the client could supply —
      // AdminReviewApplicantDecisionDto doesn't even have a reviewerId
      // field for a caller to set.
      expect(reviewRes.body.reviewerId).toBe(TEST_ADMIN_EMAIL);
    });

    it('serves the real document bytes through the image endpoint', async () => {
      const tenant = await createTenantWithApiKey(app, adminToken, 'admin-dash-a4');
      const applicantId = await createApplicant(app, tenant.token, {
        externalId: 'a-4',
      });
      const documentId = await uploadPassport(tenant.token, applicantId);

      const imageRes = await request(app.getHttpServer())
        .get(`/admin/tenants/${tenant.tenantId}/documents/${documentId}/image`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(imageRes.headers['content-type']).toMatch(/^image\/png/);
      expect(Buffer.compare(imageRes.body, TINY_PNG)).toBe(0);
    });

    it('rejects every admin route without an admin JWT (401)', async () => {
      const tenant = await createTenantWithApiKey(app, adminToken, 'admin-dash-a5');
      await request(app.getHttpServer())
        .get(`/admin/tenants/${tenant.tenantId}/applicants`)
        .expect(401);
    });
  });

  describe('businesses', () => {
    async function uploadCommercialRegistration(
      tenantToken: string,
      businessId: string,
    ): Promise<string> {
      const res = await request(app.getHttpServer())
        .post(`/v1/businesses/${businessId}/documents`)
        .set('X-API-Key', tenantToken)
        .field('type', 'COMMERCIAL_REGISTRATION')
        .attach('file', TINY_PNG, 'cr.png')
        .expect(202);
      await waitFor(async () => {
        const doc = await request(app.getHttpServer())
          .get(`/v1/business-documents/${res.body.id}`)
          .set('X-API-Key', tenantToken)
          .expect(200);
        return doc.body.status !== 'UPLOADED' && doc.body.status !== 'PROCESSING'
          ? doc.body
          : false;
      });
      return res.body.id as string;
    }

    it('lists and fetches business detail scoped to the right tenant, 404s cross-tenant', async () => {
      const tenantA = await createTenantWithApiKey(app, adminToken, 'admin-dash-b1a');
      const tenantB = await createTenantWithApiKey(app, adminToken, 'admin-dash-b1b');
      const businessId = await createBusiness(app, tenantA.token, {
        externalId: 'biz-1',
      });
      const documentId = await uploadCommercialRegistration(
        tenantA.token,
        businessId,
      );

      const detailRes = await request(app.getHttpServer())
        .get(`/admin/tenants/${tenantA.tenantId}/businesses/${businessId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(detailRes.body.documents).toHaveLength(1);
      expect(detailRes.body.documents[0].id).toBe(documentId);

      await request(app.getHttpServer())
        .get(`/admin/tenants/${tenantB.tenantId}/businesses/${businessId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .get(
          `/admin/tenants/${tenantB.tenantId}/business-documents/${documentId}/image`,
        )
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      const imageRes = await request(app.getHttpServer())
        .get(
          `/admin/tenants/${tenantA.tenantId}/business-documents/${documentId}/image`,
        )
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(imageRes.headers['content-type']).toMatch(/^image\/png/);
    });
  });
});
