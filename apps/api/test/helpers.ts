import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { CSRF_COOKIE, CSRF_HEADER } from '../src/auth/cookies';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';

export interface SentMail {
  to: string;
  kind: 'reset' | 'invitation';
  link: string;
}

/** Captures outgoing email so tests can follow reset and invitation links. */
export class FakeMail {
  sent: SentMail[] = [];
  configured = true;
  /** Set to false to act like a server without SMTP: invitations aren't delivered. */
  delivers = true;

  sendPasswordReset(to: string, _name: string, link: string) {
    this.sent.push({ to, kind: 'reset', link });
    return Promise.resolve(true);
  }

  sendInvitation(to: string, opts: { link: string }) {
    if (!this.delivers) return Promise.resolve(false);
    this.sent.push({ to, kind: 'invitation', link: opts.link });
    return Promise.resolve(true);
  }

  lastToken(to: string, kind: SentMail['kind']) {
    const mail = [...this.sent]
      .reverse()
      .find((m) => m.to === to && m.kind === kind);
    if (!mail) throw new Error(`No ${kind} email sent to ${to}`);
    return new URL(mail.link).searchParams.get('token')!;
  }
}

export async function createTestApp() {
  const mail = new FakeMail();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(mail)
    .compile();
  const app = configureApp(
    moduleRef.createNestApplication<INestApplication<App>>(),
  );
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma, mail };
}

export async function resetDatabase(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "PackageSessionLedger", "PackageSessionReservation", "PackageEnrollmentTherapyType", "PackageEnrollment", "PackageEligibleTherapyType", "TherapyPackage", "TherapyPlanRevision", "TherapyPlanReviewAmendment", "TherapyPlanReview", "TherapyGoalProgress", "TherapyPlanGoal", "TherapyPlan", "TherapyGoalCategory", "AssessmentAmendment", "AssessmentGoal", "AssessmentRecommendation", "Assessment", "AssessmentTemplateVersion", "AssessmentTemplate", "AppointmentHistory", "Appointment", "AppointmentSeries", "PatientConsent", "PatientTherapyInterest", "PatientGuardian", "Guardian", "Patient", "CenterSequence", "TherapistTimeOff", "TherapistAvailability", "TherapistSpecialization", "Therapist", "AuditLog", "Invitation", "PasswordResetToken", "Session", "CenterMembership", "User", "TherapyDurationOption", "TherapyType", "CenterWorkingHour", "CenterClosure", "CenterSchedulingSettings", "CenterGeneralSettings", "Center" CASCADE',
  );
}

/**
 * A browser stand-in: keeps cookies between requests and echoes the CSRF cookie in the
 * header on state-changing requests, like the web app's API client does.
 */
export class Browser {
  readonly agent: ReturnType<typeof request.agent>;
  private csrf = '';

  constructor(app: INestApplication<App>) {
    this.agent = request.agent(app.getHttpServer());
  }

  private capture(res: request.Response) {
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    for (const cookie of cookies) {
      const match = new RegExp(`^${CSRF_COOKIE}=([^;]*)`).exec(cookie);
      if (match) this.csrf = decodeURIComponent(match[1]);
    }
    return res;
  }

  async init() {
    this.capture(await this.agent.get('/auth/csrf'));
    return this;
  }

  get(path: string) {
    return this.agent.get(path).then((res) => this.capture(res));
  }

  send(
    method: 'post' | 'put' | 'patch' | 'delete',
    path: string,
    body?: object,
  ) {
    return this.agent[method](path)
      .set(CSRF_HEADER, this.csrf)
      .send(body ?? {})
      .then((res) => this.capture(res));
  }

  post(path: string, body?: object) {
    return this.send('post', path, body);
  }

  put(path: string, body?: object) {
    return this.send('put', path, body);
  }

  patch(path: string, body?: object) {
    return this.send('patch', path, body);
  }

  delete(path: string) {
    return this.send('delete', path);
  }
}

let counter = 0;

export function registration(
  overrides: { email?: string; centerName?: string } = {},
) {
  counter += 1;
  return {
    center: {
      name: overrides.centerName ?? `Shishu Bikash Therapy Center ${counter}`,
      phone: '01712-345678',
      address: 'House 12, Road 5, Dhanmondi, Dhaka',
      district: 'Dhaka',
      email: '',
      website: 'shishubikash.example',
    },
    owner: {
      fullName: 'Kamrul Islam',
      email: overrides.email ?? `owner${counter}@example.com`,
      mobile: '+8801812345678',
      password: 'correct horse battery',
      confirmPassword: 'correct horse battery',
    },
  };
}

export function creds(user: { email: string; password: string }) {
  return { email: user.email, password: user.password };
}

/** Registers a center and returns the owner's signed-in browser. */
export async function registerCenter(
  app: INestApplication<App>,
  overrides: { email?: string; centerName?: string } = {},
) {
  const browser = await new Browser(app).init();
  const body = registration(overrides);
  const res = await browser.post('/auth/register-center', body);
  if (res.status !== 201)
    throw new Error(`Registration failed: ${JSON.stringify(res.body)}`);
  const center = (res.body as { center: { id: string; code: string } }).center;
  return { browser, center, owner: body.owner };
}

/** Invites someone to the admin's center and accepts as a new account. */
export async function addStaff(
  app: INestApplication<App>,
  admin: Browser,
  mail: FakeMail,
  input: { email: string; role: string; fullName?: string },
) {
  const invite = await admin.post('/staff/invitations', {
    fullName: input.fullName ?? 'Staff Member',
    email: input.email,
    role: input.role,
  });
  if (invite.status !== 201)
    throw new Error(`Invite failed: ${JSON.stringify(invite.body)}`);
  const browser = await new Browser(app).init();
  const accept = await browser.post('/invitations/accept', {
    token: mail.lastToken(input.email, 'invitation'),
    password: 'staff password 1',
    confirmPassword: 'staff password 1',
  });
  if (accept.status !== 200)
    throw new Error(`Accept failed: ${JSON.stringify(accept.body)}`);
  const me = await browser.get('/auth/me');
  return {
    browser,
    membershipId: (me.body as { activeCenter: { membershipId: string } })
      .activeCenter.membershipId,
  };
}
