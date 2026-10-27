import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

import { addDays, formatIsoDate, todayIn } from '../src/common/time';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  Browser,
  FakeMail,
  addStaff,
  createTestApp,
  registerCenter,
  resetDatabase,
} from './helpers';

interface Session {
  id: string;
  status: string;
  type: string;
  date: string;
  attendance: {
    status: string;
    checkInAt: string | null;
    note?: string | null;
    revision?: number | null;
  };
  sessionStatus: string;
  noteStatus: string;
  notePending: boolean;
  packageUsage: string | null;
  note: { id: string; status: string } | null;
  session?: {
    status: string;
    completedAt: string | null;
    completedBy: { fullName: string } | null;
    voidReason: string | null;
  };
  package?: { coverage: string; chargeReason: string | null } | null;
  plan?: { id: string; status: string } | null;
  history?: { action: string; reason: string | null }[];
  sessionActions: Record<string, boolean>;
  goalsRecorded?: number | null;
}

interface Note {
  id: string;
  status: string;
  revision: number;
  template: { id: string; name: string; versionId: string; version: number };
  form: { sections: { key: string; fields: { key: string }[] }[] };
  answers: Record<string, unknown>;
  goals: {
    goalId: string;
    observation: string | null;
    measuredValue: number | null;
    goalStatus: string | null;
    progressId?: string;
  }[];
  planGoals: { id: string; title: string; status: string }[];
  completedBy: { fullName: string } | null;
  amendments: { number: number; changedFields: string[] }[];
  actions: Record<string, boolean>;
}

interface Template {
  id: string;
  name: string;
  status: string;
  isDefault: boolean;
  therapyType: { id: string } | null;
  draft: { id: string; version: number } | null;
  published: { id: string; version: number } | null;
}

interface Paged<T> {
  items: T[];
  total: number;
}

const SAT = 6;
const MON = 1;
const TUE = 2;
const OPEN_DAYS = [SAT, 0, MON, TUE, 3, 4];

const today = () => todayIn('Asia/Dhaka');
const iso = formatIsoDate;
const daysFromToday = (n: number) => iso(addDays(today(), n));

/** The first date at least `from` days ahead that falls on `dayOfWeek`. */
function nextWeekday(dayOfWeek: number, from = 1) {
  let date = addDays(today(), from);
  while (date.getUTCDay() !== dayOfWeek) date = addDays(date, 1);
  return iso(date);
}

/** The most recent working date at least `from` days back. */
function recentWorkday(from = 1) {
  let date = addDays(today(), -from);
  while (!OPEN_DAYS.includes(date.getUTCDay())) date = addDays(date, -1);
  return iso(date);
}

describe('Sessions, attendance and notes (e2e)', () => {
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

  async function ok<T>(
    res: Promise<{ status: number; body: unknown }>,
    status = 200,
  ) {
    const r = await res;
    if (r.status !== status) {
      throw new Error(
        `Expected ${status}, got ${r.status}: ${JSON.stringify(r.body)}`,
      );
    }
    return r.body as T;
  }

  async function fails(
    res: Promise<{ status: number; body: unknown }>,
    status: number,
  ) {
    const r = await res;
    expect({ status: r.status, body: r.body }).toMatchObject({ status });
    return r.body as {
      code?: string;
      message: string;
      errors?: Record<string, string>;
    };
  }

  let counter = 0;

  /**
   * A center that books in the past, with two therapists who sign in (Farhana does the
   * sessions), front desk, a manager, and two patients.
   */
  async function setup() {
    const center = await registerCenter(app);
    const admin = center.browser;
    const list = (await admin.get('/therapy-types')).body as {
      id: string;
      code: string;
    }[];
    const t = Object.fromEntries(list.map((x) => [x.code, x.id]));
    await ok(
      admin.patch('/settings/scheduling', {
        slotIntervalMinutes: 30,
        allowPastDateBooking: true,
      }),
    );
    counter += 1;
    const staffT = await addStaff(app, admin, mail, {
      email: `t${counter}@example.com`,
      role: 'THERAPIST',
      fullName: 'Farhana Akter',
    });
    const staffOther = await addStaff(app, admin, mail, {
      email: `o${counter}@example.com`,
      role: 'THERAPIST',
      fullName: 'Rafiq Hasan',
    });
    const desk = await addStaff(app, admin, mail, {
      email: `desk${counter}@example.com`,
      role: 'RECEPTIONIST',
    });
    const manager = await addStaff(app, admin, mail, {
      email: `manager${counter}@example.com`,
      role: 'MANAGER',
    });
    const therapistBody = (fullName: string, membershipId: string) => ({
      fullName,
      mobile: `01711-0${String((counter += 1)).padStart(5, '0')}`,
      specializations: { therapyTypeIds: [t.OT, t.SLT, t.ABA] },
      availability: {
        days: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          isAvailable: OPEN_DAYS.includes(dayOfWeek),
          intervals: [{ start: '09:00', end: '17:00' }],
        })),
      },
      membershipId,
    });
    const therapist = await ok<{ id: string }>(
      admin.post(
        '/therapists',
        therapistBody('Farhana Akter', staffT.membershipId),
      ),
      201,
    );
    const otherTherapist = await ok<{ id: string }>(
      admin.post(
        '/therapists',
        therapistBody('Rafiq Hasan', staffOther.membershipId),
      ),
      201,
    );
    const patient = async (fullName: string) => {
      counter += 1;
      return ok<{ id: string; code: string }>(
        admin.post('/patients', {
          fullName,
          contact: {
            contactType: 'GUARDIAN',
            fullName: 'Nasrin Akter',
            mobile: `01811-${String(counter).padStart(6, '0')}`,
            relationship: 'MOTHER',
          },
        }),
        201,
      );
    };
    return {
      ...center,
      admin,
      t,
      desk: desk.browser,
      manager: manager.browser,
      therapistUser: staffT.browser,
      otherUser: staffOther.browser,
      therapist,
      otherTherapist,
      ayaan: await patient('Ayaan Rahman'),
      zara: await patient('Zara Karim'),
    };
  }
  type Setup = Awaited<ReturnType<typeof setup>>;

  async function book(s: Setup, overrides: Record<string, unknown> = {}) {
    return ok<{ id: string }>(
      s.admin.post('/appointments', {
        patientId: s.ayaan.id,
        type: 'THERAPY_SESSION',
        therapyTypeId: s.t.OT,
        therapistId: s.therapist.id,
        durationMinutes: 45,
        date: recentWorkday(1),
        startTime: '10:00',
        ...overrides,
      }),
      201,
    );
  }

  /**
   * An appointment happening today that started `minutesAgo` minutes ago (negative:
   * later today). Booked for a future day, then moved, since center hours may not
   * include the current time.
   */
  async function todaySession(
    s: Setup,
    minutesAgo: number,
    overrides: Record<string, unknown> = {},
  ) {
    const a = await book(s, { date: nextWeekday(MON), ...overrides });
    const startAt = new Date(Date.now() - minutesAgo * 60_000);
    await prisma.appointment.update({
      where: { id: a.id },
      data: { startAt, endAt: new Date(startAt.getTime() + 45 * 60_000) },
    });
    return a;
  }

  const session = (b: Browser, id: string) =>
    ok<Session>(b.get(`/sessions/${id}`));

  const attendance = (b: Browser, id: string, body: object) =>
    b.put(`/appointments/${id}/attendance`, body);

  async function packageFor(s: Setup, overrides: Record<string, unknown> = {}) {
    const pkg = await ok<{ id: string }>(
      s.admin.post('/packages', {
        name: `OT ${(counter += 1)}`,
        therapyTypeIds: [s.t.OT],
        sessionCount: 10,
        price: '9000',
        validityValue: 60,
        validityUnit: 'DAY',
        ...overrides,
      }),
      201,
    );
    return ok<{ id: string }>(
      s.admin.post('/package-enrollments', {
        patientId: s.ayaan.id,
        packageId: pkg.id,
        activationPolicy: 'FIXED_DATE',
        startDate: daysFromToday(-14),
      }),
      201,
    );
  }

  const balance = (s: Setup, id: string) =>
    ok<{ sessions: { consumed: number; reserved: number } }>(
      s.admin.get(`/package-enrollments/${id}`),
    ).then((e) => e.sessions);

  /** An active OT plan for Ayaan with a narrative and a percentage goal, by Farhana. */
  async function activePlan(s: Setup, patientId = s.ayaan.id) {
    const draft = await ok<{ id: string; revision: number }>(
      s.therapistUser.post('/therapy-plans', {
        patientId,
        therapyTypeId: s.t.OT,
        therapistId: s.therapist.id,
        title: 'OT treatment plan',
        startDate: daysFromToday(-30),
        sessionsPerPeriod: 2,
        frequencyUnit: 'WEEK',
        goals: [
          { title: 'Improve fine motor coordination' },
          {
            title: 'Follow two-step instructions',
            measurementType: 'PERCENTAGE',
            baselineValue: 30,
            targetValue: 80,
          },
        ],
      }),
      201,
    );
    return ok<{ id: string; goals: { id: string; title: string }[] }>(
      s.therapistUser.post(`/therapy-plans/${draft.id}/activate`, {
        revision: draft.revision,
      }),
    );
  }

  // ── Attendance ────────────────────────────────────────────────────────────

  describe('attendance', () => {
    it('checks patients in, marks them late or absent, and keeps one attendance per appointment', async () => {
      const s = await setup();
      const a = await todaySession(s, 5);
      const checkedIn = await ok<Session>(
        s.desk.post(`/appointments/${a.id}/check-in`, {}),
      );
      expect(checkedIn).toMatchObject({
        status: 'SCHEDULED',
        attendance: { status: 'PRESENT' },
        sessionStatus: 'NOT_STARTED',
      });
      expect(checkedIn.attendance.checkInAt).not.toBeNull();
      // Checking in again changes nothing: still one record, same arrival time.
      const again = await ok<Session>(
        s.desk.post(`/appointments/${a.id}/check-in`, {}),
      );
      expect(again.attendance.checkInAt).toBe(checkedIn.attendance.checkInAt);
      expect(
        await prisma.sessionAttendance.count({
          where: { appointmentId: a.id },
        }),
      ).toBe(1);

      const late = await ok<Session>(
        attendance(s.desk, a.id, { status: 'LATE' }),
      );
      expect(late.attendance).toMatchObject({ status: 'LATE', revision: 2 });
      expect(
        late.history!.filter((h) => h.action === 'ATTENDANCE_RECORDED'),
      ).toHaveLength(2);
      // A stale revision is refused rather than silently overwriting.
      expect(
        (
          await fails(
            attendance(s.desk, a.id, { status: 'PRESENT', revision: 1 }),
            409,
          )
        ).code,
      ).toBe('SESSION_CHANGED');

      const b = await todaySession(s, 120, { patientId: s.zara.id });
      const lateArrival = await ok<Session>(
        s.desk.post(`/appointments/${b.id}/check-in`, { late: true }),
      );
      expect(lateArrival.attendance.status).toBe('LATE');

      // Absent makes the appointment a no-show.
      const c = await book(s, { date: recentWorkday(2) });
      const absent = await ok<Session>(
        attendance(s.desk, c.id, { status: 'ABSENT', note: 'Called, unwell' }),
      );
      expect(absent).toMatchObject({
        status: 'NO_SHOW',
        attendance: { status: 'ABSENT', note: 'Called, unwell' },
      });
      // Marking a no-show from the appointment records absence too.
      const d = await book(s, { date: recentWorkday(3) });
      await ok(
        s.desk.patch(`/appointments/${d.id}/status`, { status: 'NO_SHOW' }),
      );
      expect((await session(s.desk, d.id)).attendance.status).toBe('ABSENT');
    });

    it('refuses impossible attendance: future days, unstarted absences, cancelled appointments and bad times', async () => {
      const s = await setup();
      const future = await book(s, { date: nextWeekday(MON) });
      expect(
        (await fails(attendance(s.desk, future.id, { status: 'PRESENT' }), 409))
          .code,
      ).toBe('APPOINTMENT_NOT_DUE');
      expect(
        (await fails(attendance(s.desk, future.id, { status: 'ABSENT' }), 409))
          .code,
      ).toBe('APPOINTMENT_NOT_STARTED');
      expect(
        (await fails(s.desk.post(`/appointments/${future.id}/check-in`), 409))
          .code,
      ).toBe('CHECK_IN_NOT_TODAY');

      const past = await book(s);
      const bad = await fails(
        attendance(s.desk, past.id, {
          status: 'PRESENT',
          actualStartTime: '11:00',
          actualEndTime: '10:00',
        }),
        400,
      );
      expect(bad.errors).toEqual({
        actualEndTime: 'Must be after the session started',
      });
      expect(
        (
          await fails(
            attendance(s.desk, past.id, {
              status: 'ABSENT',
              checkInTime: '10:00',
            }),
            400,
          )
        ).errors,
      ).toHaveProperty('checkInTime');

      await ok(
        s.desk.patch(`/appointments/${past.id}/cancel`, {
          reason: 'PATIENT_REQUEST',
        }),
      );
      expect(
        (await fails(attendance(s.desk, past.id, { status: 'PRESENT' }), 409))
          .code,
      ).toBe('APPOINTMENT_CANCELLED');
      await fails(
        attendance(s.desk, '00000000-0000-4000-8000-000000000000', {
          status: 'PRESENT',
        }),
        404,
      );
    });

    it('corrects attendance after the appointment closed, with permission and a reason', async () => {
      const s = await setup();
      const a = await book(s);
      await ok(
        s.desk.post(`/sessions/${a.id}/complete`, { attendance: 'PRESENT' }),
      );
      // Front desk records attendance but can't correct it afterwards.
      await fails(attendance(s.desk, a.id, { status: 'LATE' }), 403);
      const noReason = await fails(
        attendance(s.manager, a.id, { status: 'LATE' }),
        400,
      );
      expect(noReason.errors).toHaveProperty('reason');
      const corrected = await ok<Session>(
        attendance(s.manager, a.id, {
          status: 'LATE',
          reason: 'Arrived 20 minutes late',
        }),
      );
      expect(corrected.attendance.status).toBe('LATE');
      expect(corrected.history!.at(-1)).toMatchObject({
        action: 'ATTENDANCE_CORRECTED',
        reason: 'Arrived 20 minutes late',
      });
      expect(
        await prisma.auditLog.count({
          where: { action: 'attendance.corrected', entityId: a.id },
        }),
      ).toBe(1);
      // A completed session's patient can't be made absent here: void it instead.
      expect(
        (
          await fails(
            attendance(s.manager, a.id, {
              status: 'ABSENT',
              reason: 'Never came',
            }),
            409,
          )
        ).code,
      ).toBe('USE_SESSION_CORRECTION');

      // A no-show who came after all is reopened.
      const b = await book(s, { date: recentWorkday(2) });
      await ok(attendance(s.desk, b.id, { status: 'ABSENT' }));
      const reopened = await ok<Session>(
        attendance(s.manager, b.id, {
          status: 'LATE',
          reason: 'Marked absent by mistake',
        }),
      );
      expect(reopened).toMatchObject({
        status: 'SCHEDULED',
        attendance: { status: 'LATE' },
      });
    });
  });

  // ── Session lifecycle and packages ────────────────────────────────────────

  describe('session lifecycle', () => {
    it('starts once, completes after attendance and charges the package exactly once', async () => {
      const s = await setup();
      const e = await packageFor(s);
      const a = await book(s, { packageEnrollmentId: e.id });

      const started = await ok<Session>(
        s.therapistUser.post(`/appointments/${a.id}/session`),
      );
      expect(started.sessionStatus).toBe('IN_PROGRESS');
      await ok(s.therapistUser.post(`/appointments/${a.id}/session`));
      expect(await prisma.therapySession.count()).toBe(1);

      expect(
        (await fails(s.desk.post(`/sessions/${a.id}/complete`), 409)).code,
      ).toBe('ATTENDANCE_REQUIRED');
      // Attendance alone charges nothing.
      await ok(attendance(s.desk, a.id, { status: 'PRESENT' }));
      expect(await balance(s, e.id)).toMatchObject({
        consumed: 0,
        reserved: 1,
      });

      // Completing at the same moment from three places charges once.
      const results = await Promise.all([
        s.desk.post(`/sessions/${a.id}/complete`),
        s.therapistUser.post(`/sessions/${a.id}/complete`),
        s.admin.patch(`/appointments/${a.id}/status`, { status: 'COMPLETED' }),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      const done = await session(s.admin, a.id);
      expect(done).toMatchObject({
        status: 'COMPLETED',
        sessionStatus: 'COMPLETED',
        packageUsage: 'CHARGED',
        notePending: true,
        package: { coverage: 'CHARGED', chargeReason: 'COMPLETED' },
      });
      expect(done.session!.completedAt).not.toBeNull();
      expect(
        await prisma.packageSessionLedger.count({
          where: { appointmentId: a.id, movement: 'SESSION_CONSUMPTION' },
        }),
      ).toBe(1);
      expect(await balance(s, e.id)).toMatchObject({
        consumed: 1,
        reserved: 0,
      });
      await ok(s.desk.post(`/sessions/${a.id}/complete`));
      expect(await balance(s, e.id)).toMatchObject({ consumed: 1 });

      // Closed sessions don't go back.
      expect(
        (
          await fails(
            s.admin.patch(`/appointments/${a.id}/status`, {
              status: 'NO_SHOW',
            }),
            409,
          )
        ).code,
      ).toBe('INVALID_STATUS_TRANSITION');
    });

    it('never charges on check-in, and settles no-shows and cancellations by the package', async () => {
      const s = await setup();
      const plain = await packageFor(s);
      const strict = await packageFor(s, { chargeNoShow: true });

      const today = await todaySession(s, 5, { packageEnrollmentId: plain.id });
      await ok(s.desk.post(`/appointments/${today.id}/check-in`));
      expect(await balance(s, plain.id)).toMatchObject({
        consumed: 0,
        reserved: 1,
      });

      const free = await book(s, {
        packageEnrollmentId: plain.id,
        date: recentWorkday(2),
      });
      await ok(attendance(s.desk, free.id, { status: 'ABSENT' }));
      expect((await session(s.desk, free.id)).packageUsage).toBe('RELEASED');

      const charged = await book(s, {
        packageEnrollmentId: strict.id,
        date: recentWorkday(3),
      });
      await ok(attendance(s.desk, charged.id, { status: 'ABSENT' }));
      expect(await balance(s, strict.id)).toMatchObject({ consumed: 1 });
      const chargedDetail = await session(s.admin, charged.id);
      expect(chargedDetail.package).toMatchObject({
        coverage: 'CHARGED',
        chargeReason: 'NO_SHOW',
      });
      // A charged no-show can't be reopened: an appointment is charged once.
      expect(
        (
          await fails(
            attendance(s.manager, charged.id, {
              status: 'PRESENT',
              reason: 'Came after all',
            }),
            409,
          )
        ).code,
      ).toBe('APPOINTMENT_CANNOT_REOPEN');

      const cancelled = await book(s, {
        packageEnrollmentId: plain.id,
        date: nextWeekday(TUE),
      });
      await ok(
        s.desk.patch(`/appointments/${cancelled.id}/cancel`, {
          reason: 'PATIENT_REQUEST',
        }),
      );
      expect((await session(s.desk, cancelled.id)).packageUsage).toBe(
        'RELEASED',
      );
    });

    it('voids a mistaken completion once, reversing its package charge through the ledger', async () => {
      const s = await setup();
      const e = await packageFor(s);
      const a = await book(s, { packageEnrollmentId: e.id });
      await ok(
        s.desk.post(`/sessions/${a.id}/complete`, { attendance: 'PRESENT' }),
      );
      const body = {
        outcome: 'NOT_ATTENDED',
        reason: 'Completed the wrong row',
      };
      await fails(s.desk.post(`/sessions/${a.id}/correct`, body), 403);
      const voided = await ok<Session>(
        s.manager.post(`/sessions/${a.id}/correct`, body),
      );
      expect(voided).toMatchObject({
        status: 'NO_SHOW',
        sessionStatus: 'VOIDED',
        attendance: { status: 'ABSENT' },
        packageUsage: 'REVERSED',
        session: { voidReason: 'Completed the wrong row' },
      });
      // The consumption stays; a reversal points at it.
      const ledger = await prisma.packageSessionLedger.findMany({
        where: { enrollmentId: e.id },
        orderBy: { createdAt: 'asc' },
        select: { movement: true, reversesId: true },
      });
      expect(ledger.map((m) => m.movement)).toEqual([
        'INITIAL_ALLOCATION',
        'SESSION_CONSUMPTION',
        'CONSUMPTION_REVERSAL',
      ]);
      expect(await balance(s, e.id)).toMatchObject({ consumed: 0 });
      expect(
        (await fails(s.manager.post(`/sessions/${a.id}/correct`, body), 409))
          .code,
      ).toBe('SESSION_NOT_COMPLETED');
      expect(
        await prisma.packageSessionLedger.count({
          where: { movement: 'CONSUMPTION_REVERSAL' },
        }),
      ).toBe(1);
      expect(
        (
          await fails(
            attendance(s.manager, a.id, {
              status: 'PRESENT',
              reason: 'Try to reopen',
            }),
            409,
          )
        ).code,
      ).toBe('APPOINTMENT_CANNOT_REOPEN');

      const b = await book(s, { date: recentWorkday(2) });
      await ok(
        s.desk.post(`/sessions/${b.id}/complete`, { attendance: 'LATE' }),
      );
      const notDelivered = await ok<Session>(
        s.manager.post(`/sessions/${b.id}/correct`, {
          outcome: 'NOT_DELIVERED',
          reason: 'Therapist was called away',
        }),
      );
      expect(notDelivered).toMatchObject({
        status: 'CANCELLED',
        sessionStatus: 'VOIDED',
        attendance: { status: 'LATE' },
      });
    });
  });

  // ── Notes ─────────────────────────────────────────────────────────────────

  describe('notes', () => {
    it('drafts, validates, signs off and amends a note from the default template', async () => {
      const s = await setup();
      const a = await book(s);
      // Only the session's therapist writes its note.
      await fails(s.admin.post(`/sessions/${a.id}/note`), 403);
      await fails(s.desk.post(`/sessions/${a.id}/note`), 403);
      const draft = await ok<Note>(
        s.therapistUser.post(`/sessions/${a.id}/note`),
      );
      expect(draft).toMatchObject({
        status: 'DRAFT',
        template: { name: 'Standard session note', version: 1 },
        actions: { edit: true, complete: true, amend: false },
      });
      // The center's first note created the standard template, as the default.
      const templates = await ok<Template[]>(
        s.admin.get('/session-note-templates'),
      );
      expect(templates).toMatchObject([
        { status: 'PUBLISHED', isDefault: true, therapyType: null },
      ]);
      expect((await session(s.therapistUser, a.id)).sessionStatus).toBe(
        'IN_PROGRESS',
      );
      // Opening it again returns the same note.
      expect(
        (await ok<Note>(s.therapistUser.post(`/sessions/${a.id}/note`))).id,
      ).toBe(draft.id);

      const saved = await ok<Note>(
        s.therapistUser.patch(`/sessions/${a.id}/note`, {
          revision: draft.revision,
          answers: { participation: 'good' },
        }),
      );
      expect(saved).toMatchObject({
        revision: 2,
        answers: { participation: 'good' },
      });
      const invalid = await fails(
        s.therapistUser.patch(`/sessions/${a.id}/note`, {
          revision: saved.revision,
          answers: {
            bogus: 'x',
            participation: 'excellent',
            activities_performed: 5,
          },
        }),
        400,
      );
      expect(Object.keys(invalid.errors!).sort()).toEqual([
        'answers.activities_performed',
        'answers.bogus',
        'answers.participation',
      ]);
      const missing = await fails(
        s.therapistUser.post(`/sessions/${a.id}/note/complete`, {
          revision: saved.revision,
        }),
        400,
      );
      expect(Object.keys(missing.errors!)).toEqual([
        'answers.activities_performed',
      ]);
      expect(
        (
          await fails(
            s.therapistUser.patch(`/sessions/${a.id}/note`, {
              revision: 1,
              answers: {},
            }),
            409,
          )
        ).code,
      ).toBe('NOTE_CHANGED');

      const signed = await ok<Note>(
        s.therapistUser.post(`/sessions/${a.id}/note/complete`, {
          revision: saved.revision,
          answers: {
            participation: 'good',
            activities_performed: 'Bead threading and putty play',
          },
        }),
      );
      expect(signed).toMatchObject({
        status: 'COMPLETED',
        completedBy: { fullName: 'Farhana Akter' },
        actions: { edit: false, amend: true, discard: false },
      });
      expect(
        (
          await fails(
            s.therapistUser.patch(`/sessions/${a.id}/note`, {
              revision: signed.revision,
              answers: {},
            }),
            409,
          )
        ).code,
      ).toBe('NOTE_COMPLETED');
      await fails(s.therapistUser.delete(`/sessions/${a.id}/note`), 409);

      // Clinical content: the author and administrators; never front desk, managers
      // or therapists without the patient in their care.
      await ok(s.admin.get(`/sessions/${a.id}/note`));
      await fails(s.desk.get(`/sessions/${a.id}/note`), 403);
      await fails(s.manager.get(`/sessions/${a.id}/note`), 403);
      await fails(s.otherUser.get(`/sessions/${a.id}/note`), 404);
      expect((await session(s.desk, a.id)).noteStatus).toBe('COMPLETED');
      // Others who can read it still can't change it.
      expect(
        (
          await fails(
            s.admin.post(`/sessions/${a.id}/note/amend`, {
              revision: signed.revision,
              reason: 'Not mine to change',
              answers: { activities_performed: 'x' },
            }),
            403,
          )
        ).code,
      ).toBe('NOT_RESPONSIBLE_THERAPIST');

      const unchanged = await fails(
        s.therapistUser.post(`/sessions/${a.id}/note/amend`, {
          revision: signed.revision,
          reason: 'No change really',
        }),
        400,
      );
      expect(unchanged.code).toBe('NOTHING_CHANGED');
      const amended = await ok<Note>(
        s.therapistUser.post(`/sessions/${a.id}/note/amend`, {
          revision: signed.revision,
          reason: 'Activity recorded wrongly',
          answers: {
            participation: 'good',
            activities_performed: 'Bead threading and scissor skills',
          },
        }),
      );
      expect(amended).toMatchObject({
        status: 'AMENDED',
        amendments: [{ number: 1, changedFields: ['Activities performed'] }],
        answers: { activities_performed: 'Bead threading and scissor skills' },
      });
      const original = await ok<{
        previousContent: { answers: Record<string, unknown> };
      }>(s.therapistUser.get(`/sessions/${a.id}/note/amendments/1`));
      expect(original.previousContent.answers.activities_performed).toBe(
        'Bead threading and putty play',
      );
      // The database keeps signed notes and their history.
      await expect(
        prisma.sessionNote.delete({ where: { id: draft.id } }),
      ).rejects.toThrow();
    });

    it('keeps each note on the template version it was written with', async () => {
      const s = await setup();
      const first = await book(s);
      const note = await ok<Note>(
        s.therapistUser.post(`/sessions/${first.id}/note`),
      );
      const [template] = await ok<Template[]>(
        s.admin.get('/session-note-templates'),
      );
      // Published versions are frozen; a new version is edited and published.
      const started = await ok<
        Template & { draft: { definition: Note['form'] } }
      >(s.admin.post(`/session-note-templates/${template.id}/versions`), 201);
      const definition = started.draft.definition;
      definition.sections = definition.sections.filter(
        (x) => x.key !== 'additional',
      );
      await ok(
        s.admin.patch(`/session-note-templates/${template.id}`, { definition }),
      );
      await ok(s.admin.post(`/session-note-templates/${template.id}/publish`));
      await expect(
        prisma.sessionNoteTemplateVersion.update({
          where: { id: note.template.versionId },
          data: { definition: {} },
        }),
      ).rejects.toThrow();

      const kept = await ok<Note>(
        s.therapistUser.get(`/sessions/${first.id}/note`),
      );
      expect(kept.template).toMatchObject({ version: 1 });
      expect(kept.form.sections.map((x) => x.key)).toContain('additional');
      const second = await book(s, { date: recentWorkday(2) });
      const newer = await ok<Note>(
        s.therapistUser.post(`/sessions/${second.id}/note`),
      );
      expect(newer.template.version).toBe(2);
      expect(newer.form.sections.map((x) => x.key)).not.toContain('additional');

      // Archived templates can't be chosen; therapy-specific defaults win.
      const ot = await ok<Template>(
        s.admin.post('/session-note-templates', {
          name: 'OT session note',
          therapyTypeId: s.t.OT,
          starter: true,
        }),
        201,
      );
      await ok(s.admin.post(`/session-note-templates/${ot.id}/publish`));
      await ok(
        s.admin.patch(`/session-note-templates/${ot.id}`, { isDefault: true }),
      );
      const third = await book(s, { date: recentWorkday(3) });
      expect(
        (await ok<Note>(s.therapistUser.post(`/sessions/${third.id}/note`)))
          .template.name,
      ).toBe('OT session note');
      await ok(s.admin.post(`/session-note-templates/${template.id}/archive`));
      const fourth = await book(s, { date: recentWorkday(4) });
      const refused = await fails(
        s.therapistUser.post(`/sessions/${fourth.id}/note`, {
          templateId: template.id,
        }),
        400,
      );
      expect(refused.errors).toHaveProperty('templateId');
    });

    it('records goal progress once per goal through the note, and corrects it on amendment', async () => {
      const s = await setup();
      // Patients come into a therapist's care through their appointments.
      const a = await book(s);
      const plan = await activePlan(s);
      const [narrative, percent] = plan.goals;
      // Zara becomes Farhana's patient too, with a plan of her own.
      const zaraSession = await book(s, {
        patientId: s.zara.id,
        therapyTypeId: s.t.SLT,
        date: recentWorkday(2),
      });
      const zaraPlan = await activePlan(s, s.zara.id);
      const draft = await ok<Note>(
        s.therapistUser.post(`/sessions/${a.id}/note`),
      );
      expect(draft.planGoals.map((g) => g.id)).toEqual([
        narrative.id,
        percent.id,
      ]);
      const entries = [
        { goalId: narrative.id, observation: 'Picked up beads with support' },
        { goalId: percent.id, measuredValue: 80 },
      ];

      const wrong = await fails(
        s.therapistUser.patch(`/sessions/${a.id}/note`, {
          revision: draft.revision,
          goals: [
            { goalId: zaraPlan.goals[0].id, observation: 'Not this patient' },
            { goalId: percent.id, measuredValue: 150 },
            { goalId: percent.id },
          ],
        }),
        400,
      );
      expect(Object.keys(wrong.errors!).sort()).toEqual([
        'goals.0.goalId',
        'goals.1.measuredValue',
        'goals.2.goalId',
      ]);
      const saved = await ok<Note>(
        s.therapistUser.patch(`/sessions/${a.id}/note`, {
          revision: draft.revision,
          answers: { activities_performed: 'Fine motor circuit' },
          goals: entries,
        }),
      );
      // Drafts hold progress on the note only.
      expect(await prisma.therapyGoalProgress.count()).toBe(0);

      const signed = await ok<Note>(
        s.therapistUser.post(`/sessions/${a.id}/note/complete`, {
          revision: saved.revision,
        }),
      );
      const rows = await prisma.therapyGoalProgress.findMany({
        orderBy: { createdAt: 'asc' },
      });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.sessionNoteId === signed.id)).toBe(true);
      expect(rows.find((r) => r.goalId === percent.id)!.measuredValue).toBe(80);
      // Reaching the target value doesn't decide the goal's status.
      const goal = await prisma.therapyPlanGoal.findUniqueOrThrow({
        where: { id: percent.id },
      });
      expect(goal.status).toBe('NOT_STARTED');
      // The database refuses a second entry for the same note and goal.
      await expect(
        prisma.therapyGoalProgress.create({
          data: {
            centerId: rows[0].centerId,
            therapyPlanId: plan.id,
            goalId: percent.id,
            observationDate: rows[0].observationDate,
            sessionNoteId: signed.id,
            recordedById: rows[0].recordedById,
          },
        }),
      ).rejects.toThrow();

      const amended = await ok<Note>(
        s.therapistUser.post(`/sessions/${a.id}/note/amend`, {
          revision: signed.revision,
          reason: 'Scored the wrong trial set',
          goals: [
            entries[0],
            {
              goalId: percent.id,
              measuredValue: 60,
              goalStatus: 'IN_PROGRESS',
            },
          ],
        }),
      );
      expect(amended.goals.find((g) => g.goalId === percent.id)).toMatchObject({
        measuredValue: 60,
        goalStatus: 'IN_PROGRESS',
      });
      const after = await prisma.therapyGoalProgress.findMany({
        where: { goalId: percent.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(after).toHaveLength(2);
      expect(after[1]).toMatchObject({
        correctsId: after[0].id,
        correctionReason: 'Scored the wrong trial set',
        sessionNoteId: signed.id,
      });
      expect(
        (
          await prisma.therapyPlanGoal.findUniqueOrThrow({
            where: { id: percent.id },
          })
        ).status,
      ).toBe('IN_PROGRESS');
      const removed = await fails(
        s.therapistUser.post(`/sessions/${a.id}/note/amend`, {
          revision: amended.revision,
          reason: 'Drop a goal',
          goals: [entries[0]],
        }),
        400,
      );
      expect(removed.errors).toHaveProperty('goals');

      // A note without an active plan for its therapy simply has no goals to record.
      const noPlan = await ok<Note>(
        s.therapistUser.post(`/sessions/${zaraSession.id}/note`),
      );
      expect(noPlan.planGoals).toEqual([]);
      await ok(
        s.therapistUser.post(`/sessions/${zaraSession.id}/note/complete`, {
          revision: noPlan.revision,
          answers: { activities_performed: 'Articulation drills' },
        }),
      );
    });
  });

  // ── Lists, visibility and isolation ───────────────────────────────────────

  describe('lists and access', () => {
    it('shows the day, history, my sessions and a patient’s sessions within reach', async () => {
      const s = await setup();
      const arrived = await todaySession(s, 5);
      await todaySession(s, -120, { patientId: s.zara.id });
      await todaySession(s, 60, {
        therapistId: s.otherTherapist.id,
        patientId: s.zara.id,
      });
      await ok(s.desk.post(`/appointments/${arrived.id}/check-in`));
      const done = await book(s);
      await ok(
        s.desk.post(`/sessions/${done.id}/complete`, { attendance: 'PRESENT' }),
      );

      const day = await ok<
        Paged<Session> & { summary: Record<string, number> }
      >(s.desk.get('/sessions/today'));
      expect(day.summary).toMatchObject({
        expected: 3,
        arrived: 1,
        notMarked: 2,
        completed: 0,
      });
      expect(day.items).toHaveLength(3);
      const present = await ok<Paged<Session>>(
        s.desk.get('/sessions/today?attendance=PRESENT'),
      );
      expect(present.items.map((i) => i.id)).toEqual([arrived.id]);
      expect(
        (
          await ok<Paged<Session>>(
            s.desk.get(`/sessions/today?search=${s.zara.code}`),
          )
        ).total,
      ).toBe(2);
      expect(present.items[0].sessionActions).toMatchObject({
        checkIn: false,
        markLate: true,
        complete: true,
        writeNote: false,
      });

      // Therapists only see their own sessions.
      const own = await ok<Paged<Session>>(
        s.therapistUser.get('/sessions/today'),
      );
      expect(own.total).toBe(2);
      const mine = await ok<{
        today: Session[];
        pendingNotes: Session[];
        recent: Session[];
      }>(s.therapistUser.get('/my-sessions'));
      expect(mine.today).toHaveLength(2);
      expect(mine.pendingNotes.map((p) => p.id)).toEqual([done.id]);
      expect(mine.recent.map((p) => p.id)).toEqual([done.id]);
      await fails(s.otherUser.get(`/sessions/${done.id}`), 404);

      const pending = await ok<Paged<Session>>(
        s.manager.get('/sessions?noteStatus=PENDING'),
      );
      expect(pending.items.map((i) => i.id)).toEqual([done.id]);

      const patient = await ok<Paged<Session>>(
        s.desk.get(`/patients/${s.ayaan.id}/sessions`),
      );
      expect(patient.total).toBe(2);
      expect(patient.items.every((i) => i.goalsRecorded === null)).toBe(true);
    });

    it('keeps another center’s sessions, attendance, notes and templates out of reach', async () => {
      const s = await setup();
      const a = await book(s);
      await ok(s.therapistUser.post(`/sessions/${a.id}/note`));
      const other = await registerCenter(app);
      await fails(other.browser.get(`/sessions/${a.id}`), 404);
      await fails(
        other.browser.put(`/appointments/${a.id}/attendance`, {
          status: 'PRESENT',
        }),
        404,
      );
      await fails(other.browser.post(`/sessions/${a.id}/complete`), 404);
      await fails(other.browser.get(`/sessions/${a.id}/note`), 404);
      expect(
        await ok<Template[]>(other.browser.get('/session-note-templates')),
      ).toEqual([]);
      expect(
        (await ok<Paged<Session>>(other.browser.get('/sessions'))).total,
      ).toBe(0);
    });
  });
});
