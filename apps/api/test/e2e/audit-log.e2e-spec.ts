import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  createTenantWithApiKey,
  createTestApp,
  getOwnerClient,
  loginAsTestAdmin,
  resetDatabase,
  resetQueue,
  seedAdmin,
  TEST_ADMIN_EMAIL,
} from './utils/test-app';

// Phase 8: the read endpoint AuditLogService's own Phase 0 comment
// deferred, plus the new admin-login-attempt auditing.
describe('Audit log (e2e)', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let adminToken: string;

  beforeAll(async () => {
    owner = getOwnerClient();
    app = await createTestApp();
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
  });

  it('records both successful and failed admin login attempts', async () => {
    await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email: TEST_ADMIN_EMAIL, password: 'definitely-wrong' })
      .expect(401);

    const res = await request(app.getHttpServer())
      .get('/admin/audit-log')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const actions = res.body.map((l: { action: string }) => l.action);
    // beforeEach's own loginAsTestAdmin() already contributed one success
    // entry before this test's explicit failed attempt.
    expect(actions).toContain('admin.login.success');
    expect(actions).toContain('admin.login.failure');
  });

  it('filters by tenantId, and every entry created for a tenant carries it', async () => {
    const tenantA = await createTenantWithApiKey(
      app,
      adminToken,
      'audit-log-a',
    );
    const tenantB = await createTenantWithApiKey(
      app,
      adminToken,
      'audit-log-b',
    );

    const res = await request(app.getHttpServer())
      .get(`/admin/audit-log?tenantId=${tenantA.tenantId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Both tenant creation and its API-key issuance are tenantId-tagged —
    // filtering to tenant A's id must include both and exclude tenant B's.
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    for (const entry of res.body) {
      expect(entry.tenantId).toBe(tenantA.tenantId);
    }
    expect(
      res.body.some(
        (l: { targetId: string }) => l.targetId === tenantB.tenantId,
      ),
    ).toBe(false);
  });

  it('rejects an unauthenticated request (401)', async () => {
    await request(app.getHttpServer()).get('/admin/audit-log').expect(401);
  });

  it('caps the response at the requested limit', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/audit-log?limit=1')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.length).toBeLessThanOrEqual(1);
  });
});
