import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  createTestApp,
  getOwnerClient,
  resetDatabase,
  resetQueue,
  seedAdmin,
  TEST_ADMIN_EMAIL,
} from './utils/test-app';

// Phase 8: verifies the throttling *mechanism* itself actually works —
// ThrottlerModule.forRoot()'s skipIf outside NODE_ENV=production exists
// specifically so the rest of this e2e suite's own login-heavy pattern
// (loginAsTestAdmin() in nearly every file's beforeEach) doesn't 429
// itself (see app.module.ts's comment for the full story) — which means
// every *other* e2e file necessarily runs with throttling off. This file
// is the one place that deliberately flips process.env.NODE_ENV to
// 'production' around a burst of requests to prove the guard is real, not
// just configured and never exercised.
describe('Admin login throttling (e2e)', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    owner = getOwnerClient();
    app = await createTestApp();
  });

  afterAll(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    await app.close();
    await owner.$disconnect();
    await resetQueue();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    await resetQueue();
    await seedAdmin(owner);
  });

  it('429s after the configured limit, only when NODE_ENV=production', async () => {
    // Same shared app instance every other file uses, but with throttling
    // forced on for just this test — skipIf reads process.env.NODE_ENV
    // per-request (not once at module-compile time), so this takes effect
    // immediately without rebuilding the app.
    process.env.NODE_ENV = 'production';
    try {
      const attempt = () =>
        request(app.getHttpServer())
          .post('/admin/auth/login')
          .send({ email: TEST_ADMIN_EMAIL, password: 'wrong-password' });

      // The configured limit is 5/60s (see AdminAuthController's
      // @Throttle()) — the first 5 should be real 401s (wrong password),
      // not throttled yet.
      for (let i = 0; i < 5; i++) {
        const res = await attempt();
        expect(res.status).toBe(401);
      }
      // The 6th within the same window is throttled, not a 6th real
      // auth attempt.
      const throttled = await attempt();
      expect(throttled.status).toBe(429);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('does not throttle when NODE_ENV is not production', async () => {
    process.env.NODE_ENV = 'development';
    for (let i = 0; i < 8; i++) {
      const res = await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send({ email: TEST_ADMIN_EMAIL, password: 'wrong-password' });
      expect(res.status).toBe(401);
    }
  });
});
