import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { PasswordService } from '../src/auth/password.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  Browser,
  createTestApp,
  creds,
  registerCenter,
  registration,
  resetDatabase,
} from './helpers';

describe('Platform administration (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const ADMIN = { username: 'admin', password: 'super admin password' };

  async function createPlatformAdmin() {
    await prisma.user.create({
      data: {
        username: ADMIN.username,
        email: 'admin@platform.carezino.local',
        fullName: 'Platform Administrator',
        passwordHash: await new PasswordService().hash(ADMIN.password),
        isPlatformAdmin: true,
      },
    });
  }

  async function signInAsAdmin() {
    const browser = await new Browser(app).init();
    const res = await browser.post('/auth/admin/login', ADMIN);
    if (res.status !== 204) throw new Error(JSON.stringify(res.body));
    return browser;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createPlatformAdmin();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('admin sign-in', () => {
    it('signs a platform admin in by username, case-insensitively', async () => {
      const browser = await new Browser(app).init();
      const res = await browser.post('/auth/admin/login', {
        username: ' ADMIN ',
        password: ADMIN.password,
      });
      expect(res.status).toBe(204);
      const me = await browser.get('/auth/me');
      expect(me.body.user).toMatchObject({
        username: 'admin',
        isPlatformAdmin: true,
      });
      expect(me.body.activeCenter).toBeNull();
    });

    it('gives one generic error for a wrong password, an unknown user and a non-admin', async () => {
      const { owner } = await registerCenter(app);
      await prisma.user.update({
        where: { email: owner.email },
        data: { username: 'centerowner' },
      });
      const browser = await new Browser(app).init();
      const attempts = await Promise.all([
        browser.post('/auth/admin/login', { ...ADMIN, password: 'wrong one!' }),
        browser.post('/auth/admin/login', {
          username: 'nobody',
          password: 'whatever1',
        }),
        browser.post('/auth/admin/login', {
          username: 'centerowner',
          password: owner.password,
        }),
      ]);
      for (const res of attempts) {
        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Incorrect username or password');
      }
    });
  });

  describe('platform endpoints', () => {
    it('are closed to anonymous users and to center staff, even center admins', async () => {
      const server = app.getHttpServer();
      expect((await request(server).get('/platform/centers')).status).toBe(401);

      const { browser: centerAdmin, center } = await registerCenter(app);
      expect((await centerAdmin.get('/platform/centers')).status).toBe(403);
      expect(
        (await centerAdmin.get(`/platform/centers/${center.id}`)).status,
      ).toBe(403);
      expect(
        (await centerAdmin.post('/platform/centers', registration())).status,
      ).toBe(403);
    });

    it('lists every center with its staff count and first administrator', async () => {
      await registerCenter(app, { centerName: 'Alpha Therapy' });
      await registerCenter(app, { centerName: 'Beta Therapy' });
      const admin = await signInAsAdmin();

      const all = await admin.get('/platform/centers');
      expect(all.status).toBe(200);
      expect(all.body.total).toBe(2);
      expect(all.body.items[0]).toMatchObject({
        activeStaff: 1,
        primaryAdmin: { fullName: 'Kamrul Islam' },
      });
      expect(JSON.stringify(all.body)).not.toContain('passwordHash');

      const search = await admin.get('/platform/centers?search=alpha');
      expect(search.body.items.map((c: { name: string }) => c.name)).toEqual([
        'Alpha Therapy',
      ]);
    });

    it('registers a center and its administrator, who can then sign in', async () => {
      const admin = await signInAsAdmin();
      const body = registration({ centerName: 'Alo Child Development Center' });
      const res = await admin.post('/platform/centers', body);
      expect(res.status).toBe(201);
      expect(res.body.center.code).toMatch(/^ACDC-\d{4}$/);

      // The super admin's own session is unchanged.
      const me = await admin.get('/auth/me');
      expect(me.body.user.username).toBe('admin');

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'center.created' },
        include: { actor: true },
      });
      expect(audit.actor?.username).toBe('admin');
      expect(audit.metadata).toMatchObject({ via: 'platform_admin' });

      const owner = await new Browser(app).init();
      expect((await owner.post('/auth/login', creds(body.owner))).status).toBe(
        204,
      );
      const ownerMe = await owner.get('/auth/me');
      expect(ownerMe.body.activeCenter).toMatchObject({
        id: res.body.center.id,
        role: 'CENTER_ADMIN',
      });

      const detail = await admin.get(`/platform/centers/${res.body.center.id}`);
      expect(detail.body).toMatchObject({
        name: 'Alo Child Development Center',
        counts: { activeStaff: 1, inactiveStaff: 0, pendingInvitations: 0 },
        administrators: [{ email: body.owner.email, status: 'ACTIVE' }],
      });
    });

    it('works while public registration is closed', async () => {
      process.env.PUBLIC_REGISTRATION_ENABLED = 'false';
      try {
        const admin = await signInAsAdmin();
        expect(
          (await admin.post('/platform/centers', registration())).status,
        ).toBe(201);
      } finally {
        process.env.PUBLIC_REGISTRATION_ENABLED = 'true';
      }
    });

    it('validates the registration and rejects a taken owner email', async () => {
      const admin = await signInAsAdmin();
      const body = registration();
      const mismatch = await admin.post('/platform/centers', {
        ...body,
        owner: { ...body.owner, confirmPassword: 'something else' },
      });
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.errors['owner.confirmPassword']).toBeDefined();

      expect((await admin.post('/platform/centers', body)).status).toBe(201);
      const again = await admin.post('/platform/centers', body);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('EMAIL_TAKEN');
      expect(await prisma.center.count()).toBe(1);
    });

    it('returns 404 for a center that does not exist', async () => {
      const admin = await signInAsAdmin();
      const res = await admin.get(
        '/platform/centers/00000000-0000-0000-0000-000000000000',
      );
      expect(res.status).toBe(404);
    });
  });
});
