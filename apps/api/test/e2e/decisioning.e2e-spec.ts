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
  waitFor,
} from './utils/test-app';

// A minimal valid 1x1 transparent PNG — real bytes, so magic-byte sniffing
// accepts it as a genuine image.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const HIGH_CONFIDENCE_OCR = {
  rawText: 'looks great',
  fields: [{ name: 'number', value: 'N1234567', confidence: 0.98 }],
  overallConfidence: 0.95,
};
const LOW_CONFIDENCE_OCR = {
  rawText: 'blurry',
  fields: [{ name: 'number', value: '???', confidence: 0.3 }],
  overallConfidence: 0.3,
};
const PASSING_BIOMETRICS = {
  faceMatch: { score: 0.3, verdict: 'MATCH' as const },
  liveness: { score: 0.9, verdict: 'LIVE' as const },
  engine: 'test-engine',
  rawResult: {},
};
const FAILING_BIOMETRICS = {
  faceMatch: { score: 0.3, verdict: 'MATCH' as const },
  liveness: { score: 0.2, verdict: 'SPOOF' as const },
  engine: 'test-engine',
  rawResult: {},
};

describe('Decisioning — Applicant + Business (e2e, stubbed sidecars)', () => {
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
    // Same cross-spec-file BullMQ lesson as every other e2e file sharing
    // this Redis — see README's Phase 2 section.
    await resetQueue();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    await resetQueue();
    await seedAdmin(owner);
    adminToken = await loginAsTestAdmin(app);
    extractMock.mockReset();
    verifyMock.mockReset();
  });

  /** Uploads a passport + birth certificate (both EXTRACTED) and a
   * biometric check reaching the given outcome, for one applicant. */
  async function setUpApplicant(
    tenantToken: string,
    applicantId: string,
    biometricsResult: typeof PASSING_BIOMETRICS | typeof FAILING_BIOMETRICS,
  ): Promise<void> {
    extractMock.mockResolvedValue(HIGH_CONFIDENCE_OCR);
    const passportRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/documents`)
      .set('X-API-Key', tenantToken)
      .field('type', 'PASSPORT')
      .attach('file', TINY_PNG, 'passport.png')
      .expect(202);
    await waitFor(async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/documents/${passportRes.body.id}`)
        .set('X-API-Key', tenantToken)
        .expect(200);
      return res.body.status === 'EXTRACTED' ? res.body : false;
    });

    const birthCertRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/documents`)
      .set('X-API-Key', tenantToken)
      .field('type', 'BIRTH_CERTIFICATE')
      .attach('file', TINY_PNG, 'cert.png')
      .expect(202);
    await waitFor(async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/documents/${birthCertRes.body.id}`)
        .set('X-API-Key', tenantToken)
        .expect(200);
      return res.body.status === 'EXTRACTED' ? res.body : false;
    });

    const selfieRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/documents`)
      .set('X-API-Key', tenantToken)
      .field('type', 'SELFIE')
      .attach('file', TINY_PNG, 'selfie.png')
      .expect(202);

    verifyMock.mockResolvedValue(biometricsResult);
    const checkRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/biometric-checks`)
      .set('X-API-Key', tenantToken)
      .send({ selfieDocumentId: selfieRes.body.id })
      .expect(202);

    await waitFor(async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/biometric-checks/${checkRes.body.id}`)
        .set('X-API-Key', tenantToken)
        .expect(200);
      return res.body.status !== 'PROCESSING' ? res.body : false;
    });
  }

  it('approves an applicant when passport, birth certificate, and biometric check are all confidently good', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-decide-approve',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 'a-1',
    });
    await setUpApplicant(tenant.token, applicantId, PASSING_BIOMETRICS);

    const decideRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/decision`)
      .set('X-API-Key', tenant.token)
      .expect(201);

    expect(decideRes.body.status).toBe('APPROVED');

    const getRes = await request(app.getHttpServer())
      .get(`/v1/applicants/${applicantId}/decision`)
      .set('X-API-Key', tenant.token)
      .expect(200);
    expect(getRes.body.status).toBe('APPROVED');
    expect(getRes.body.id).toBe(decideRes.body.id);
  });

  it('flags NEEDS_REVIEW when the biometric check is below threshold, never auto-REJECTED', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-decide-review',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 'a-2',
    });
    await setUpApplicant(tenant.token, applicantId, FAILING_BIOMETRICS);

    const decideRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/decision`)
      .set('X-API-Key', tenant.token)
      .expect(201);

    expect(decideRes.body.status).toBe('NEEDS_REVIEW');
  });

  it('rejects deciding when required verifications are missing (400)', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-decide-missing',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 'a-3',
    });

    await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/decision`)
      .set('X-API-Key', tenant.token)
      .expect(400);
  });

  it('lets a manual review resolve a NEEDS_REVIEW decision to REJECTED, then blocks reviewing a non-NEEDS_REVIEW decision', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-decide-manual',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 'a-4',
    });
    await setUpApplicant(tenant.token, applicantId, FAILING_BIOMETRICS);

    await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/decision`)
      .set('X-API-Key', tenant.token)
      .expect(201);

    const reviewRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/decision/review`)
      .set('X-API-Key', tenant.token)
      .send({
        status: 'REJECTED',
        reviewerId: 'reviewer-1',
        notes: 'confirmed fraud',
      })
      .expect(201);
    expect(reviewRes.body.status).toBe('REJECTED');
    expect(reviewRes.body.reviewerId).toBe('reviewer-1');

    const getRes = await request(app.getHttpServer())
      .get(`/v1/applicants/${applicantId}/decision`)
      .set('X-API-Key', tenant.token)
      .expect(200);
    expect(getRes.body.status).toBe('REJECTED');

    // Now the latest decision is REJECTED, not NEEDS_REVIEW — reviewing again is rejected.
    await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/decision/review`)
      .set('X-API-Key', tenant.token)
      .send({ status: 'APPROVED', reviewerId: 'reviewer-2' })
      .expect(400);
  });

  it('the review queue (?decisionStatus=NEEDS_REVIEW) includes only applicants currently in that state', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-decide-queue',
    );
    const approvedId = await createApplicant(app, tenant.token, {
      externalId: 'a-approved',
    });
    await setUpApplicant(tenant.token, approvedId, PASSING_BIOMETRICS);
    await request(app.getHttpServer())
      .post(`/v1/applicants/${approvedId}/decision`)
      .set('X-API-Key', tenant.token)
      .expect(201);

    const reviewId = await createApplicant(app, tenant.token, {
      externalId: 'a-review',
    });
    await setUpApplicant(tenant.token, reviewId, FAILING_BIOMETRICS);
    await request(app.getHttpServer())
      .post(`/v1/applicants/${reviewId}/decision`)
      .set('X-API-Key', tenant.token)
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get('/v1/applicants?decisionStatus=NEEDS_REVIEW')
      .set('X-API-Key', tenant.token)
      .expect(200);

    const ids = listRes.body.map((a: { id: string }) => a.id);
    expect(ids).toContain(reviewId);
    expect(ids).not.toContain(approvedId);
  });

  it('rejects a cross-tenant decision request (404, not the leaked resource)', async () => {
    const tenantA = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-decide-iso-a',
    );
    const tenantB = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-decide-iso-b',
    );
    const applicantOfA = await createApplicant(app, tenantA.token, {
      externalId: 'a-iso',
    });
    await setUpApplicant(tenantA.token, applicantOfA, PASSING_BIOMETRICS);

    await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantOfA}/decision`)
      .set('X-API-Key', tenantB.token)
      .expect(404);
  });
});

describe('Decisioning — Business (e2e, stubbed OCR)', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let adminToken: string;
  let extractMock: jest.Mock;

  beforeAll(async () => {
    owner = getOwnerClient();
    extractMock = jest.fn();
    const ocrStub: Pick<OcrClientService, 'extract'> = { extract: extractMock };
    app = await createTestAppWithStubOcr(ocrStub);
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
  });

  async function uploadAndWait(
    tenantToken: string,
    businessId: string,
    type: 'COMMERCIAL_REGISTRATION' | 'CHAMBER_OF_COMMERCE' | 'TAX_ID',
  ): Promise<void> {
    const res = await request(app.getHttpServer())
      .post(`/v1/businesses/${businessId}/documents`)
      .set('X-API-Key', tenantToken)
      .field('type', type)
      .attach('file', TINY_PNG, `${type}.png`)
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
  }

  it('approves a business once all three required KYB documents are EXTRACTED', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-kyb-decide-approve',
    );
    const businessId = await createBusiness(app, tenant.token, {
      externalId: 'biz-decide-1',
    });

    extractMock.mockResolvedValue(HIGH_CONFIDENCE_OCR);
    await uploadAndWait(tenant.token, businessId, 'COMMERCIAL_REGISTRATION');
    await uploadAndWait(tenant.token, businessId, 'CHAMBER_OF_COMMERCE');
    await uploadAndWait(tenant.token, businessId, 'TAX_ID');

    const decideRes = await request(app.getHttpServer())
      .post(`/v1/businesses/${businessId}/decision`)
      .set('X-API-Key', tenant.token)
      .expect(201);
    expect(decideRes.body.status).toBe('APPROVED');
  });

  it('flags NEEDS_REVIEW when a required KYB document is below confidence, never auto-REJECTED', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-kyb-decide-review',
    );
    const businessId = await createBusiness(app, tenant.token, {
      externalId: 'biz-decide-2',
    });

    extractMock.mockResolvedValue(HIGH_CONFIDENCE_OCR);
    await uploadAndWait(tenant.token, businessId, 'COMMERCIAL_REGISTRATION');
    await uploadAndWait(tenant.token, businessId, 'CHAMBER_OF_COMMERCE');
    extractMock.mockResolvedValue(LOW_CONFIDENCE_OCR);
    await uploadAndWait(tenant.token, businessId, 'TAX_ID');

    const decideRes = await request(app.getHttpServer())
      .post(`/v1/businesses/${businessId}/decision`)
      .set('X-API-Key', tenant.token)
      .expect(201);
    expect(decideRes.body.status).toBe('NEEDS_REVIEW');
  });

  it('rejects deciding when a required KYB document type is missing entirely (400)', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-kyb-decide-missing',
    );
    const businessId = await createBusiness(app, tenant.token, {
      externalId: 'biz-decide-3',
    });

    extractMock.mockResolvedValue(HIGH_CONFIDENCE_OCR);
    await uploadAndWait(tenant.token, businessId, 'COMMERCIAL_REGISTRATION');
    // CHAMBER_OF_COMMERCE and TAX_ID never uploaded.

    await request(app.getHttpServer())
      .post(`/v1/businesses/${businessId}/decision`)
      .set('X-API-Key', tenant.token)
      .expect(400);
  });
});
