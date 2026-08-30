import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { BiometricsClientService } from '../../src/modules/biometric-checks/biometrics-client/biometrics-client.service';
import type { OcrClientService } from '../../src/modules/documents/ocr-client/ocr-client.service';
import {
  createApplicant,
  createTenantWithApiKey,
  createTestAppWithStubOcrAndBiometrics,
  getOwnerClient,
  loginAsTestAdmin,
  resetDatabase,
  resetQueue,
  seedAdmin,
  waitFor,
} from './utils/test-app';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const GOOD_OCR_RESULT = {
  rawText: 'P<LBYALFTAISI<<SEIF',
  fields: [{ name: 'number', value: 'N1234567', confidence: 0.98 }],
  overallConfidence: 0.95,
};

describe('Biometric checks -> async liveness + face match (e2e, stubbed sidecars)', () => {
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
    // See document-upload.e2e-spec.ts's afterAll for why this matters —
    // this file's sidecar-down test can leave a delayed retry in Redis
    // that would otherwise leak into the next spec file's differently-
    // configured mock.
    await resetQueue();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    await resetQueue();
    await seedAdmin(owner);
    adminToken = await loginAsTestAdmin(app);
    extractMock.mockReset();
    extractMock.mockResolvedValue(GOOD_OCR_RESULT);
    verifyMock.mockReset();
  });

  async function setupApplicantWithPassportAndSelfie(
    apiKeyToken: string,
    externalId: string,
  ) {
    const applicantId = await createApplicant(app, apiKeyToken, { externalId });

    const passportRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/documents`)
      .set('X-API-Key', apiKeyToken)
      .field('type', 'PASSPORT')
      .attach('file', TINY_PNG, 'passport.png')
      .expect(202);

    const selfieRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/documents`)
      .set('X-API-Key', apiKeyToken)
      .field('type', 'SELFIE')
      .attach('file', TINY_PNG, 'selfie.png')
      .expect(202);

    return {
      applicantId,
      passportDocumentId: passportRes.body.id as string,
      selfieDocumentId: selfieRes.body.id as string,
    };
  }

  it("auto-selects the applicant's passport as reference and reaches COMPLETED for a confident match", async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-bio-happy',
    );
    const { applicantId, selfieDocumentId } =
      await setupApplicantWithPassportAndSelfie(tenant.token, 'cust-1');

    verifyMock.mockResolvedValue({
      faceMatch: { score: 0.3, verdict: 'MATCH' },
      liveness: { score: 0.95, verdict: 'LIVE' },
      engine: 'dlib-resnet-v1+minifasnet-v2',
      rawResult: {},
    });

    const createRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/biometric-checks`)
      .set('X-API-Key', tenant.token)
      .send({ selfieDocumentId })
      .expect(202);

    expect(createRes.body.status).toBe('PROCESSING');

    const result = await waitFor(async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/biometric-checks/${createRes.body.id}`)
        .set('X-API-Key', tenant.token)
        .expect(200);
      return res.body.status !== 'PROCESSING' ? res.body : false;
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.faceMatchVerdict).toBe('MATCH');
    expect(result.livenessVerdict).toBe('LIVE');
    expect(verifyMock).toHaveBeenCalledTimes(1);
  });

  it('flags NEEDS_REVIEW when the liveness score is below threshold even though the verdict claims LIVE', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-bio-lowconf',
    );
    const { applicantId, selfieDocumentId } =
      await setupApplicantWithPassportAndSelfie(tenant.token, 'cust-2');

    verifyMock.mockResolvedValue({
      faceMatch: { score: 0.3, verdict: 'MATCH' },
      liveness: { score: 0.4, verdict: 'LIVE' }, // below NEEDS_REVIEW_LIVENESS_THRESHOLD (0.7)
      engine: 'dlib-resnet-v1+minifasnet-v2',
      rawResult: {},
    });

    const createRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/biometric-checks`)
      .set('X-API-Key', tenant.token)
      .send({ selfieDocumentId })
      .expect(202);

    const result = await waitFor(async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/biometric-checks/${createRes.body.id}`)
        .set('X-API-Key', tenant.token)
        .expect(200);
      return res.body.status !== 'PROCESSING' ? res.body : false;
    });

    expect(result.status).toBe('NEEDS_REVIEW');
  });

  it('marks FAILED and rethrows for BullMQ retry when the biometrics sidecar errors', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-bio-sidecar-down',
    );
    const { applicantId, selfieDocumentId } =
      await setupApplicantWithPassportAndSelfie(tenant.token, 'cust-3');

    verifyMock.mockRejectedValue(
      new Error('Biometric verification failed with status 503'),
    );

    const createRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/biometric-checks`)
      .set('X-API-Key', tenant.token)
      .send({ selfieDocumentId })
      .expect(202);

    const result = await waitFor(
      async () => {
        const res = await request(app.getHttpServer())
          .get(`/v1/biometric-checks/${createRes.body.id}`)
          .set('X-API-Key', tenant.token)
          .expect(200);
        return res.body.status === 'FAILED' ? res.body : false;
      },
      { timeoutMs: 20_000 },
    );

    expect(result.status).toBe('FAILED');
  });

  it('accepts an explicit referenceDocumentId instead of auto-selecting', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-bio-explicit-ref',
    );
    const { applicantId, passportDocumentId, selfieDocumentId } =
      await setupApplicantWithPassportAndSelfie(tenant.token, 'cust-4');

    verifyMock.mockResolvedValue({
      faceMatch: { score: 0.2, verdict: 'MATCH' },
      liveness: { score: 0.9, verdict: 'LIVE' },
      engine: 'dlib-resnet-v1+minifasnet-v2',
      rawResult: {},
    });

    const createRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/biometric-checks`)
      .set('X-API-Key', tenant.token)
      .send({ selfieDocumentId, referenceDocumentId: passportDocumentId })
      .expect(202);

    expect(createRes.body.referenceDocumentId).toBe(passportDocumentId);
  });

  it('rejects with 400 when no passport exists and no referenceDocumentId is given', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-bio-no-passport',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 'cust-5',
    });

    const selfieRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/documents`)
      .set('X-API-Key', tenant.token)
      .field('type', 'SELFIE')
      .attach('file', TINY_PNG, 'selfie.png')
      .expect(202);

    await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/biometric-checks`)
      .set('X-API-Key', tenant.token)
      .send({ selfieDocumentId: selfieRes.body.id })
      .expect(400);

    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('rejects with 400 when selfieDocumentId actually points at a PASSPORT document (wrong type)', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-bio-wrong-type',
    );
    const { applicantId, passportDocumentId } =
      await setupApplicantWithPassportAndSelfie(tenant.token, 'cust-6');

    await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/biometric-checks`)
      .set('X-API-Key', tenant.token)
      .send({ selfieDocumentId: passportDocumentId })
      .expect(400);

    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('rejects with 404 when selfieDocumentId belongs to a different tenant (not the leaked resource)', async () => {
    const tenantA = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-bio-cross-a',
    );
    const tenantB = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-bio-cross-b',
    );

    const { selfieDocumentId } = await setupApplicantWithPassportAndSelfie(
      tenantA.token,
      'cust-7',
    );
    const applicantOfB = await createApplicant(app, tenantB.token, {
      externalId: 'cust-8',
    });

    await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantOfB}/biometric-checks`)
      .set('X-API-Key', tenantB.token)
      .send({ selfieDocumentId })
      .expect(404);

    expect(verifyMock).not.toHaveBeenCalled();
  });
});
