import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { PrismaService } from '../src/prisma/prisma.service';
import { StaffService } from '../src/staff/staff.service';
import {
  Browser,
  FakeMail,
  addStaff,
  createTestApp,
  creds,
  registerCenter,
  resetDatabase,
} from './helpers';

describe('Tenancy, RBAC and staff (e2e)', () => {
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

  it('rejects unauthenticated access to protected endpoints', async () => {
    const server = app.getHttpServer();
    for (const path of [
      '/auth/me',
      '/centers/current',
      '/centers/my',
      '/staff',
      '/staff/invitations',
    ]) {
      expect((await request(server).get(path)).status).toBe(401);
    }
  });

  describe('role-based permissions', () => {
    it('enforces each role’s permissions on the server', async () => {
      const { browser: admin, center } = await registerCenter(app);
      const manager = await addStaff(app, admin, mail, {
        email: 'manager@example.com',
        role: 'MANAGER',
      });
      const therapist = await addStaff(app, admin, mail, {
        email: 'therapist@example.com',
        role: 'THERAPIST',
      });
      const receptionist = await addStaff(app, admin, mail, {
        email: 'reception@example.com',
        role: 'RECEPTIONIST',
      });

      // Everyone can read the center profile.
      for (const user of [manager, therapist, receptionist]) {
        const res = await user.browser.get('/centers/current');
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(center.id);
      }

      // Managers see staff but can't invite, change roles or edit the center.
      expect((await manager.browser.get('/staff')).status).toBe(200);
      expect(
        (
          await manager.browser.post('/staff/invitations', {
            fullName: 'X',
            email: 'x@example.com',
            role: 'THERAPIST',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await manager.browser.patch(`/staff/${therapist.membershipId}/role`, {
            role: 'MANAGER',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await manager.browser.patch(
            `/staff/${therapist.membershipId}/status`,
            { status: 'INACTIVE' },
          )
        ).status,
      ).toBe(403);
      expect(
        (await manager.browser.patch('/centers/current', { name: 'Renamed' }))
          .status,
      ).toBe(403);

      // Therapists and receptionists can't see the staff list.
      expect((await therapist.browser.get('/staff')).status).toBe(403);
      expect((await receptionist.browser.get('/staff')).status).toBe(403);
      expect(
        (await receptionist.browser.get(`/staff/${therapist.membershipId}`))
          .status,
      ).toBe(403);

      // Admins can do all of it.
      expect(
        (
          await admin.patch(`/staff/${therapist.membershipId}/role`, {
            role: 'MANAGER',
          })
        ).status,
      ).toBe(200);
      expect(
        (await admin.patch('/centers/current', { name: 'Renamed Center' }))
          .status,
      ).toBe(200);
    });

    it('stops staff from changing their own role or status', async () => {
      const { browser: admin } = await registerCenter(app);
      const me = await admin.get('/auth/me');
      const own = me.body.activeCenter.membershipId as string;
      const res = await admin.patch(`/staff/${own}/role`, {
        role: 'THERAPIST',
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('SELF_CHANGE');
      expect(
        (await admin.patch(`/staff/${own}/status`, { status: 'INACTIVE' }))
          .status,
      ).toBe(403);
    });

    it('does not let a lower role grant itself permissions through the request body', async () => {
      const { browser: admin } = await registerCenter(app);
      const therapist = await addStaff(app, admin, mail, {
        email: 't@example.com',
        role: 'THERAPIST',
      });
      const res = await therapist.browser.patch('/auth/me', {
        role: 'CENTER_ADMIN',
      });
      expect(res.status).toBe(400);
      const me = await therapist.browser.get('/auth/me');
      expect(me.body.activeCenter.role).toBe('THERAPIST');
    });
  });

  describe('center isolation', () => {
    it('keeps every center’s staff, invitations and profile out of reach of other centers', async () => {
      const a = await registerCenter(app, { centerName: 'Alpha Center' });
      const b = await registerCenter(app, { centerName: 'Beta Center' });
      const bStaff = await addStaff(app, b.browser, mail, {
        email: 'beta.staff@example.com',
        role: 'THERAPIST',
      });
      const bInvite = await b.browser.post('/staff/invitations', {
        fullName: 'Pending Beta',
        email: 'pending.beta@example.com',
        role: 'RECEPTIONIST',
      });

      const list = await a.browser.get('/staff');
      expect(
        list.body.items.map((s: { email: string }) => s.email),
      ).not.toContain('beta.staff@example.com');
      expect(list.body.total).toBe(1);

      expect(
        (await a.browser.get(`/staff/${bStaff.membershipId}`)).status,
      ).toBe(404);
      expect(
        (
          await a.browser.patch(`/staff/${bStaff.membershipId}/role`, {
            role: 'MANAGER',
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await a.browser.patch(`/staff/${bStaff.membershipId}/status`, {
            status: 'INACTIVE',
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await a.browser.post(
            `/staff/invitations/${bInvite.body.invitation.id}/revoke`,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await a.browser.post(
            `/staff/invitations/${bInvite.body.invitation.id}/resend`,
          )
        ).status,
      ).toBe(404);
      expect((await a.browser.get('/staff/invitations')).body).toEqual([]);

      // The center comes from the session, never the request.
      expect(
        (
          await a.browser.patch('/centers/current', {
            id: b.center.id,
            name: 'Hijacked',
          })
        ).status,
      ).toBe(400);
      expect(
        (await a.browser.get('/centers/current?centerId=' + b.center.id)).body
          .id,
      ).toBe(a.center.id);
      expect(
        (await a.browser.post('/centers/switch', { centerId: b.center.id }))
          .status,
      ).toBe(403);

      const beta = await prisma.center.findUniqueOrThrow({
        where: { id: b.center.id },
      });
      expect(beta.name).toBe('Beta Center');
      const membership = await prisma.centerMembership.findUniqueOrThrow({
        where: { id: bStaff.membershipId },
      });
      expect(membership).toMatchObject({ role: 'THERAPIST', status: 'ACTIVE' });
    });

    it('does not let center code, ID or status be edited, and audits changes', async () => {
      const { browser, center } = await registerCenter(app);
      expect(
        (await browser.patch('/centers/current', { code: 'NEW-1' })).status,
      ).toBe(400);
      expect(
        (await browser.patch('/centers/current', { status: 'SUSPENDED' }))
          .status,
      ).toBe(400);
      const res = await browser.patch('/centers/current', {
        phone: '02-9876543',
        district: '',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        code: center.code,
        phone: '029876543',
        district: null,
      });
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'center.updated' },
      });
      expect(audit?.metadata).toMatchObject({
        phone: { to: '029876543' },
        district: { from: 'Dhaka', to: null },
      });
    });
  });

  describe('invitations', () => {
    it('creates an account from an invitation and signs the new staff member in', async () => {
      const { browser: admin, center } = await registerCenter(app);
      const invite = await admin.post('/staff/invitations', {
        fullName: 'Farhana Rahman',
        email: 'Farhana@Example.com',
        mobile: '01712 000111',
        role: 'THERAPIST',
      });
      expect(invite.status).toBe(201);
      expect(invite.body.emailDelivered).toBe(true);
      expect(JSON.stringify(invite.body)).not.toMatch(/token/i);
      expect((await admin.get('/staff/invitations')).body).toHaveLength(1);

      const token = mail.lastToken('farhana@example.com', 'invitation');
      const invitee = await new Browser(app).init();
      const preview = await invitee.post('/invitations/preview', { token });
      expect(preview.body).toMatchObject({
        valid: true,
        email: 'farhana@example.com',
        role: 'THERAPIST',
        accountExists: false,
      });

      const short = await invitee.post('/invitations/accept', {
        token,
        password: 'short',
        confirmPassword: 'short',
      });
      expect(short.status).toBe(400);

      const accept = await invitee.post('/invitations/accept', {
        token,
        password: 'therapist password',
        confirmPassword: 'therapist password',
      });
      expect(accept.status).toBe(200);
      const me = await invitee.get('/auth/me');
      expect(me.body.user).toMatchObject({
        fullName: 'Farhana Rahman',
        mobile: '01712000111',
      });
      expect(me.body.activeCenter).toMatchObject({
        id: center.id,
        role: 'THERAPIST',
      });

      // Single use.
      const again = await new Browser(app).init();
      expect(
        (
          await again.post('/invitations/accept', {
            token,
            password: 'x'.repeat(10),
            confirmPassword: 'x'.repeat(10),
          })
        ).status,
      ).toBe(404);
      expect((await admin.get('/staff/invitations')).body).toHaveLength(0);
      expect(
        await prisma.auditLog.count({
          where: { action: 'staff.invitation_accepted' },
        }),
      ).toBe(1);
    });

    it('requires an existing account holder to be signed in as the invited email', async () => {
      const alpha = await registerCenter(app, { centerName: 'Alpha Center' });
      const beta = await registerCenter(app, { centerName: 'Beta Center' });
      const outsider = await registerCenter(app, {
        centerName: 'Gamma Center',
      });

      await alpha.browser.post('/staff/invitations', {
        fullName: 'Beta Owner',
        email: beta.owner.email,
        role: 'THERAPIST',
      });
      const token = mail.lastToken(beta.owner.email, 'invitation');

      const anonymous = await new Browser(app).init();
      expect(
        (await anonymous.post('/invitations/preview', { token })).body
          .accountExists,
      ).toBe(true);
      const signedOut = await anonymous.post('/invitations/accept', { token });
      expect(signedOut.status).toBe(401);
      expect(signedOut.body.code).toBe('SIGN_IN_REQUIRED');

      const wrong = await outsider.browser.post('/invitations/accept', {
        token,
      });
      expect(wrong.status).toBe(403);
      expect(wrong.body.code).toBe('WRONG_ACCOUNT');

      const ok = await beta.browser.post('/invitations/accept', { token });
      expect(ok.status).toBe(200);
      const me = await beta.browser.get('/auth/me');
      expect(me.body.centers).toHaveLength(2);
      expect(me.body.activeCenter).toMatchObject({
        id: alpha.center.id,
        role: 'THERAPIST',
      });
      // Accepting didn't change their password or identity.
      expect(
        (
          await new Browser(app)
            .init()
            .then((b) => b.post('/auth/login', creds(beta.owner)))
        ).status,
      ).toBe(204);
    });

    it('signs a browser into the new account when it accepts for a new email', async () => {
      const { browser: admin } = await registerCenter(app);
      const other = await registerCenter(app, { centerName: 'Other Center' });
      await admin.post('/staff/invitations', {
        fullName: 'New Person',
        email: 'new.person@example.com',
        role: 'RECEPTIONIST',
      });
      const res = await other.browser.post('/invitations/accept', {
        token: mail.lastToken('new.person@example.com', 'invitation'),
        password: 'new person password',
        confirmPassword: 'new person password',
      });
      expect(res.status).toBe(200);
      const me = await other.browser.get('/auth/me');
      expect(me.body.user.email).toBe('new.person@example.com');
      expect(me.body.activeCenter.role).toBe('RECEPTIONIST');
    });

    it('rejects duplicate, revoked and expired invitations', async () => {
      const { browser: admin } = await registerCenter(app);
      const body = {
        fullName: 'Rafiq Uddin',
        email: 'rafiq@example.com',
        role: 'RECEPTIONIST',
      };
      const first = await admin.post('/staff/invitations', body);
      const dup = await admin.post('/staff/invitations', body);
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('INVITATION_PENDING');

      const firstToken = mail.lastToken('rafiq@example.com', 'invitation');
      expect(
        (
          await admin.post(
            `/staff/invitations/${first.body.invitation.id}/resend`,
          )
        ).status,
      ).toBe(200);
      const secondToken = mail.lastToken('rafiq@example.com', 'invitation');
      expect(secondToken).not.toBe(firstToken);
      const invitee = await new Browser(app).init();
      expect(
        (await invitee.post('/invitations/preview', { token: firstToken }))
          .body,
      ).toMatchObject({ valid: false });

      expect(
        (
          await admin.post(
            `/staff/invitations/${first.body.invitation.id}/revoke`,
          )
        ).status,
      ).toBe(204);
      expect(
        (await invitee.post('/invitations/preview', { token: secondToken }))
          .body,
      ).toMatchObject({ valid: false });

      // Expired invitations can be replaced by a new one.
      const again = await admin.post('/staff/invitations', body);
      expect(again.status).toBe(201);
      await prisma.invitation.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const expiredToken = mail.lastToken('rafiq@example.com', 'invitation');
      expect(
        (await invitee.post('/invitations/preview', { token: expiredToken }))
          .body,
      ).toMatchObject({ valid: false });
      expect((await admin.post('/staff/invitations', body)).status).toBe(201);
    });

    it('refuses to invite someone who is already on the staff list', async () => {
      const { browser: admin, owner } = await registerCenter(app);
      const res = await admin.post('/staff/invitations', {
        fullName: 'Me',
        email: owner.email,
        role: 'THERAPIST',
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ALREADY_MEMBER');
    });
  });

  describe('deactivation and the last administrator', () => {
    it('cuts off a deactivated member at once and restores access on reactivation', async () => {
      const { browser: admin } = await registerCenter(app);
      const therapist = await addStaff(app, admin, mail, {
        email: 't@example.com',
        role: 'THERAPIST',
      });
      expect((await therapist.browser.get('/centers/current')).status).toBe(
        200,
      );

      const off = await admin.patch(`/staff/${therapist.membershipId}/status`, {
        status: 'INACTIVE',
      });
      expect(off.status).toBe(200);
      expect(off.body.status).toBe('INACTIVE');
      expect((await therapist.browser.get('/centers/current')).status).toBe(
        403,
      );
      const me = await therapist.browser.get('/auth/me');
      expect(me.body.activeCenter).toBeNull();
      expect(me.body.centers).toEqual([]);

      // History is kept.
      expect(
        await prisma.centerMembership.count({
          where: { id: therapist.membershipId },
        }),
      ).toBe(1);
      expect(
        await prisma.auditLog.count({ where: { action: 'staff.deactivated' } }),
      ).toBe(1);

      expect(
        (
          await admin.patch(`/staff/${therapist.membershipId}/status`, {
            status: 'ACTIVE',
          })
        ).status,
      ).toBe(200);
      expect((await therapist.browser.get('/centers/current')).status).toBe(
        200,
      );
    });

    it('never leaves a center without an active administrator', async () => {
      const { browser: owner, center } = await registerCenter(app);
      const second = await addStaff(app, owner, mail, {
        email: 'admin2@example.com',
        role: 'CENTER_ADMIN',
      });
      const ownerMembership = (await owner.get('/auth/me')).body.activeCenter
        .membershipId as string;

      // Two admins try to demote each other at the same moment: exactly one wins.
      const results = await Promise.all([
        owner.patch(`/staff/${second.membershipId}/role`, { role: 'MANAGER' }),
        second.browser.patch(`/staff/${ownerMembership}/role`, {
          role: 'MANAGER',
        }),
      ]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(
        results.find((r) => r.status !== 200)?.status,
      ).toBeGreaterThanOrEqual(403);
      expect(
        await prisma.centerMembership.count({
          where: {
            centerId: center.id,
            role: 'CENTER_ADMIN',
            status: 'ACTIVE',
          },
        }),
      ).toBe(1);
    });

    it('blocks removing the last active administrator at the service layer', async () => {
      const { center } = await registerCenter(app);
      const admin = await prisma.centerMembership.findFirstOrThrow({
        where: { centerId: center.id },
      });
      const staff = app.get(StaffService);
      // A caller other than the admin themself, e.g. a future platform-support tool.
      const tenant = {
        centerId: center.id,
        userId: admin.userId,
        membershipId: '00000000-0000-0000-0000-000000000000',
        role: 'CENTER_ADMIN' as const,
        permissions: ['staff.deactivate', 'staff.assign_role'] as never,
      };
      await expect(
        staff.changeStatus(tenant, admin.id, 'INACTIVE', null),
      ).rejects.toMatchObject({
        response: { code: 'LAST_ADMIN' },
      });
      await expect(
        staff.changeRole(tenant, admin.id, 'MANAGER', null),
      ).rejects.toMatchObject({
        response: { code: 'LAST_ADMIN' },
      });
    });
  });

  describe('multi-center users', () => {
    it('applies the role of the active center and only switches to centers the user belongs to', async () => {
      const alpha = await registerCenter(app, { centerName: 'Alpha Center' });
      const beta = await registerCenter(app, { centerName: 'Beta Center' });
      const gamma = await registerCenter(app, { centerName: 'Gamma Center' });

      // Alpha's owner is also a therapist at Beta.
      await beta.browser.post('/staff/invitations', {
        fullName: 'Alpha Owner',
        email: alpha.owner.email,
        role: 'THERAPIST',
      });
      await alpha.browser.post('/invitations/accept', {
        token: mail.lastToken(alpha.owner.email, 'invitation'),
      });

      // Accepting moved the session into Beta, where they're a therapist.
      let me = await alpha.browser.get('/auth/me');
      expect(me.body.activeCenter).toMatchObject({
        id: beta.center.id,
        role: 'THERAPIST',
      });
      expect(me.body.activeCenter.permissions).not.toContain('staff.read');
      expect((await alpha.browser.get('/staff')).status).toBe(403);

      expect(
        (
          await alpha.browser.post('/centers/switch', {
            centerId: alpha.center.id,
          })
        ).status,
      ).toBe(204);
      me = await alpha.browser.get('/auth/me');
      expect(me.body.activeCenter).toMatchObject({
        id: alpha.center.id,
        role: 'CENTER_ADMIN',
      });
      expect((await alpha.browser.get('/staff')).status).toBe(200);

      expect(
        (
          await alpha.browser.post('/centers/switch', {
            centerId: gamma.center.id,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await alpha.browser.post('/centers/switch', {
            centerId: 'not-a-uuid',
          })
        ).status,
      ).toBe(400);

      // Once Beta deactivates them, they can't switch back in.
      const membership = await prisma.centerMembership.findFirstOrThrow({
        where: { centerId: beta.center.id, user: { email: alpha.owner.email } },
      });
      await beta.browser.patch(`/staff/${membership.id}/status`, {
        status: 'INACTIVE',
      });
      expect(
        (
          await alpha.browser.post('/centers/switch', {
            centerId: beta.center.id,
          })
        ).status,
      ).toBe(403);
      expect(
        (await alpha.browser.get('/centers/my')).body.map(
          (c: { id: string }) => c.id,
        ),
      ).toEqual([alpha.center.id]);
    });

    it('asks a user with several centers to choose one after signing in', async () => {
      const alpha = await registerCenter(app, { centerName: 'Alpha Center' });
      const beta = await registerCenter(app, { centerName: 'Beta Center' });
      await beta.browser.post('/staff/invitations', {
        fullName: 'Alpha Owner',
        email: alpha.owner.email,
        role: 'MANAGER',
      });
      await alpha.browser.post('/invitations/accept', {
        token: mail.lastToken(alpha.owner.email, 'invitation'),
      });

      const fresh = await new Browser(app).init();
      await fresh.post('/auth/login', creds(alpha.owner));
      const me = await fresh.get('/auth/me');
      expect(me.body.activeCenter).toBeNull();
      expect(me.body.centers).toHaveLength(2);
      const blocked = await fresh.get('/centers/current');
      expect(blocked.status).toBe(403);
      expect(
        (await fresh.post('/centers/switch', { centerId: beta.center.id }))
          .status,
      ).toBe(204);
      expect((await fresh.get('/centers/current')).body.id).toBe(
        beta.center.id,
      );
    });
  });

  describe('staff list', () => {
    it('searches, filters and paginates within the center', async () => {
      const { browser: admin } = await registerCenter(app);
      await addStaff(app, admin, mail, {
        email: 'nadia@example.com',
        role: 'MANAGER',
        fullName: 'Nadia Chowdhury',
      });
      await addStaff(app, admin, mail, {
        email: 'farhana@example.com',
        role: 'THERAPIST',
        fullName: 'Farhana Rahman',
      });
      await addStaff(app, admin, mail, {
        email: 'sumi@example.com',
        role: 'THERAPIST',
        fullName: 'Sumi Akter',
      });

      const all = await admin.get('/staff?pageSize=2&page=1');
      expect(all.body).toMatchObject({ total: 4, page: 1, pageSize: 2 });
      expect(all.body.items).toHaveLength(2);
      expect(all.body.items[0]).not.toHaveProperty('passwordHash');

      const therapists = await admin.get('/staff?role=THERAPIST');
      expect(therapists.body.total).toBe(2);
      const search = await admin.get('/staff?search=nadia');
      expect(
        search.body.items.map((s: { fullName: string }) => s.fullName),
      ).toEqual(['Nadia Chowdhury']);
      expect((await admin.get('/staff?role=OWNER')).status).toBe(400);
      expect((await admin.get('/staff?pageSize=1000')).status).toBe(400);
    });
  });
});
