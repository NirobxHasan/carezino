import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AuditService } from '../src/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  Browser,
  FakeMail,
  creds,
  createTestApp,
  registerCenter,
  registration,
  resetDatabase,
} from './helpers';

describe('Authentication (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mail: FakeMail;

  beforeAll(async () => {
    ({ app, prisma, mail } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    mail.sent = [];
  });

  afterAll(async () => {
    await app.close();
  });

  describe('center registration', () => {
    it('creates the center, owner and CENTER_ADMIN membership, and signs the owner in', async () => {
      const { browser, center } = await registerCenter(app, {
        centerName: 'Shishu Bikash Therapy',
      });
      expect(center.code).toMatch(/^SBT-\d{4}$/);

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: (await browser.get('/auth/me')).body.user.email },
      });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.mobile).toBe('01812345678');

      const me = await browser.get('/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.activeCenter).toMatchObject({
        id: center.id,
        role: 'CENTER_ADMIN',
      });
      expect(me.body.activeCenter.permissions).toContain('staff.assign_role');
      expect(JSON.stringify(me.body)).not.toContain('passwordHash');

      const saved = await prisma.center.findUniqueOrThrow({
        where: { id: center.id },
      });
      expect(saved).toMatchObject({
        country: 'Bangladesh',
        timezone: 'Asia/Dhaka',
        currency: 'BDT',
        website: 'https://shishubikash.example',
        email: null,
      });
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'center.created' },
      });
      expect(audit?.centerId).toBe(center.id);
    });

    it('rolls everything back when a step fails', async () => {
      const spy = jest
        .spyOn(app.get(AuditService), 'record')
        .mockRejectedValueOnce(new Error('simulated failure'));
      const browser = await new Browser(app).init();
      const res = await browser.post('/auth/register-center', registration());
      spy.mockRestore();

      expect(res.status).toBe(500);
      expect(await prisma.center.count()).toBe(0);
      expect(await prisma.user.count()).toBe(0);
      expect(await prisma.centerMembership.count()).toBe(0);
    });

    it('rejects a second registration with the same owner email, case-insensitively', async () => {
      await registerCenter(app, { email: 'owner@example.com' });
      const browser = await new Browser(app).init();
      const res = await browser.post(
        '/auth/register-center',
        registration({ email: '  OWNER@Example.com ' }),
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EMAIL_TAKEN');
      expect(await prisma.center.count()).toBe(1);
    });

    it('validates input and refuses fields that are not editable', async () => {
      const browser = await new Browser(app).init();
      const body = registration();
      const res = await browser.post('/auth/register-center', {
        center: { ...body.center, phone: 'abc', code: 'HACK-1' },
        owner: { ...body.owner, confirmPassword: 'different' },
      });
      expect(res.status).toBe(400);
      expect(res.body.errors).toMatchObject({
        'center.phone': expect.any(String),
        'center.code': expect.any(String),
      });

      const mismatch = await browser.post('/auth/register-center', {
        ...body,
        owner: { ...body.owner, confirmPassword: 'different' },
      });
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.errors['owner.confirmPassword']).toBeDefined();
    });

    it('is closed to the public when registration is disabled', async () => {
      process.env.PUBLIC_REGISTRATION_ENABLED = 'false';
      try {
        const browser = await new Browser(app).init();
        const status = await browser.get('/auth/registration');
        expect(status.body).toEqual({ enabled: false });
        const res = await browser.post('/auth/register-center', registration());
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('REGISTRATION_CLOSED');
      } finally {
        process.env.PUBLIC_REGISTRATION_ENABLED = 'true';
      }
    });
  });

  describe('login and sessions', () => {
    it('signs in with valid credentials and sets a hardened session cookie', async () => {
      const { owner } = await registerCenter(app);
      const browser = await new Browser(app).init();
      const res = await browser.post('/auth/login', {
        email: owner.email.toUpperCase(),
        password: owner.password,
      });
      expect(res.status).toBe(204);
      const cookie = ([] as string[])
        .concat(res.headers['set-cookie'])
        .find((c) => c.startsWith('cz_session='));
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Lax/);
      expect(cookie).not.toMatch(/Expires/); // not "remembered": ends with the browser
      expect((await browser.get('/auth/me')).status).toBe(200);

      // Only the token's hash is stored.
      const raw = /^cz_session=([^;]+)/.exec(cookie!)![1];
      expect(await prisma.session.count({ where: { tokenHash: raw } })).toBe(0);
    });

    it('sets a persistent cookie only when asked to remember the session', async () => {
      const { owner } = await registerCenter(app);
      const browser = await new Browser(app).init();
      const res = await browser.post('/auth/login', {
        ...creds(owner),
        remember: true,
      });
      const cookie = ([] as string[])
        .concat(res.headers['set-cookie'])
        .find((c) => c.startsWith('cz_session='));
      expect(cookie).toMatch(/Expires=/);
    });

    it('gives the same generic error for a wrong password and an unknown email', async () => {
      const { owner } = await registerCenter(app);
      const browser = await new Browser(app).init();
      const wrong = await browser.post('/auth/login', {
        email: owner.email,
        password: 'not it at all',
      });
      const unknown = await browser.post('/auth/login', {
        email: 'nobody@example.com',
        password: 'whatever1',
      });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.message).toBe(unknown.body.message);
      expect(wrong.body.message).toBe('Incorrect email or password');
    });

    it('refuses disabled users with the same generic error', async () => {
      const { owner } = await registerCenter(app);
      await prisma.user.update({
        where: { email: owner.email },
        data: { status: 'DISABLED' },
      });
      const browser = await new Browser(app).init();
      const res = await browser.post('/auth/login', creds(owner));
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Incorrect email or password');
    });

    it('rejects expired, revoked and forged sessions', async () => {
      const { browser, owner } = await registerCenter(app);
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: owner.email },
      });

      await prisma.session.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await browser.get('/auth/me')).status).toBe(401);

      const second = await new Browser(app).init();
      await second.post('/auth/login', creds(owner));
      await prisma.session.updateMany({
        where: { userId: user.id },
        data: { revokedAt: new Date() },
      });
      expect((await second.get('/auth/me')).status).toBe(401);

      const forged = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', 'cz_session=forged-value');
      expect(forged.status).toBe(401);
    });

    it('reports the session without an error status when signed out', async () => {
      const anonymous = await request(app.getHttpServer()).get('/auth/session');
      expect(anonymous.status).toBe(200);
      expect(anonymous.body).toEqual({ me: null });

      const { browser, center } = await registerCenter(app);
      const signedIn = await browser.get('/auth/session');
      expect(signedIn.body.me.activeCenter.id).toBe(center.id);
    });

    it('revokes the session on logout', async () => {
      const { browser } = await registerCenter(app);
      const cookieHeader = await prisma.session.count({
        where: { revokedAt: null },
      });
      expect(cookieHeader).toBe(1);
      expect((await browser.post('/auth/logout')).status).toBe(204);
      expect(await prisma.session.count({ where: { revokedAt: null } })).toBe(
        0,
      );
      expect((await browser.get('/auth/me')).status).toBe(401);
    });

    it('requires the CSRF header on state-changing requests', async () => {
      const { owner } = await registerCenter(app);
      const browser = await new Browser(app).init();
      const res = await browser.agent.post('/auth/login').send(creds(owner));
      expect(res.status).toBe(403);
      const wrong = await browser.agent
        .post('/auth/login')
        .set('x-csrf-token', 'nope')
        .send(creds(owner));
      expect(wrong.status).toBe(403);
    });

    it('rate-limits repeated sign-in attempts for an account', async () => {
      const { owner } = await registerCenter(app);
      const browser = await new Browser(app).init();
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        statuses.push(
          (
            await browser.post('/auth/login', {
              email: owner.email,
              password: 'wrong password',
            })
          ).status,
        );
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses[10]).toBe(429);
    });
  });

  describe('password reset', () => {
    it('responds identically whether or not the email exists', async () => {
      const { owner } = await registerCenter(app);
      const browser = await new Browser(app).init();
      const known = await browser.post('/auth/forgot-password', {
        email: owner.email,
      });
      const unknown = await browser.post('/auth/forgot-password', {
        email: 'ghost@example.com',
      });
      expect(known.status).toBe(202);
      expect(unknown.status).toBe(202);
      expect(known.body).toEqual(unknown.body);
      expect(JSON.stringify(known.body)).not.toMatch(/token/i);
      await new Promise((r) => setImmediate(r));
      expect(
        mail.sent.filter((m) => m.kind === 'reset').map((m) => m.to),
      ).toEqual([owner.email]);
    });

    it('resets the password once, then the link stops working and old sessions end', async () => {
      const { browser: oldSession, owner } = await registerCenter(app);
      const browser = await new Browser(app).init();
      await browser.post('/auth/forgot-password', { email: owner.email });
      await new Promise((r) => setImmediate(r));
      const token = mail.lastToken(owner.email, 'reset');
      expect(
        await prisma.passwordResetToken.count({ where: { tokenHash: token } }),
      ).toBe(0);

      const reset = await browser.post('/auth/reset-password', {
        token,
        password: 'brand new password',
        confirmPassword: 'brand new password',
      });
      expect(reset.status).toBe(204);
      expect((await oldSession.get('/auth/me')).status).toBe(401);

      const reuse = await browser.post('/auth/reset-password', {
        token,
        password: 'another new password',
        confirmPassword: 'another new password',
      });
      expect(reuse.status).toBe(400);
      expect(reuse.body.code).toBe('RESET_TOKEN_INVALID');

      expect((await browser.post('/auth/login', creds(owner))).status).toBe(
        401,
      );
      expect(
        (
          await browser.post('/auth/login', {
            email: owner.email,
            password: 'brand new password',
          })
        ).status,
      ).toBe(204);
    });

    it('rejects expired links and superseded links', async () => {
      const { owner } = await registerCenter(app);
      const browser = await new Browser(app).init();
      await browser.post('/auth/forgot-password', { email: owner.email });
      await new Promise((r) => setImmediate(r));
      const first = mail.lastToken(owner.email, 'reset');
      await browser.post('/auth/forgot-password', { email: owner.email });
      await new Promise((r) => setImmediate(r));
      const second = mail.lastToken(owner.email, 'reset');

      const body = {
        password: 'brand new password',
        confirmPassword: 'brand new password',
      };
      expect(
        (await browser.post('/auth/reset-password', { ...body, token: first }))
          .status,
      ).toBe(400);

      await prisma.passwordResetToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(
        (await browser.post('/auth/reset-password', { ...body, token: second }))
          .status,
      ).toBe(400);
    });
  });

  describe('profile and password change', () => {
    it('changes the password, keeping this session and ending the others', async () => {
      const { browser, owner } = await registerCenter(app);
      const other = await new Browser(app).init();
      await other.post('/auth/login', creds(owner));

      const wrong = await browser.post('/auth/change-password', {
        currentPassword: 'not my password',
        password: 'a whole new password',
        confirmPassword: 'a whole new password',
      });
      expect(wrong.status).toBe(400);
      expect(wrong.body.errors.currentPassword).toBeDefined();

      const res = await browser.post('/auth/change-password', {
        currentPassword: owner.password,
        password: 'a whole new password',
        confirmPassword: 'a whole new password',
      });
      expect(res.status).toBe(204);
      expect((await browser.get('/auth/me')).status).toBe(200);
      expect((await other.get('/auth/me')).status).toBe(401);
    });

    it('updates name and mobile but not email', async () => {
      const { browser } = await registerCenter(app);
      const res = await browser.patch('/auth/me', {
        fullName: 'Kamrul H. Islam',
        mobile: '01911-222333',
      });
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({
        fullName: 'Kamrul H. Islam',
        mobile: '01911222333',
      });
      const email = await browser.patch('/auth/me', {
        email: 'new@example.com',
      });
      expect(email.status).toBe(400);
    });
  });
});
