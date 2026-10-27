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

interface Pkg {
  id: string;
  code: string;
  name: string;
  price: string;
  sessionCount: number;
  isActive: boolean;
  therapyTypes: { id: string; code: string }[];
  enrollmentCount: number;
  actions: Record<string, boolean>;
}

interface Sessions {
  purchased: number;
  total: number;
  consumed: number;
  reserved: number;
  remaining: number;
  availableToBook: number;
  additionalCredits?: number;
  manualDebits?: number;
  reversed?: number;
}

interface Enrollment {
  id: string;
  code: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  sessions: Sessions;
  finalPrice: string;
  renewedFromId: string | null;
  pricing: {
    catalogPrice: string;
    discountType: string;
    discountValue: string | null;
    discountAmount: string;
    finalPrice: string;
  };
  terms: { sessionCount: number };
  packageSnapshot: { price: string; sessionCount: number; name: string };
  package: { id: string; name: string };
  customEndDate: boolean;
  upcoming: { id: string }[];
  renewals: { id: string }[];
  actions: Record<string, boolean>;
}

interface Appointment {
  id: string;
  status: string;
  packageEnrollmentId: string | null;
  package: {
    enrollmentId: string;
    coverage: string;
    chargeReason: string | null;
    releaseReason: string | null;
    consumptionId: string | null;
  } | null;
}

interface Movement {
  type: string;
  quantity: number;
  reason: string | null;
  chargeReason: string | null;
  releaseReason: string | null;
  reversed: boolean;
  appointment: { id: string } | null;
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

describe('Packages and enrollments (e2e)', () => {
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
      problems?: { reason: string }[];
      removable?: boolean;
    };
  }

  let counter = 0;

  /**
   * A center that books in the past, with an OT/SLT/ABA therapist who signs in, front
   * desk, a manager, and two patients.
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
    });
    const desk = await addStaff(app, admin, mail, {
      email: `desk${counter}@example.com`,
      role: 'RECEPTIONIST',
    });
    const manager = await addStaff(app, admin, mail, {
      email: `manager${counter}@example.com`,
      role: 'MANAGER',
    });
    const therapist = await ok<{ id: string }>(
      admin.post('/therapists', {
        fullName: 'Farhana Akter',
        mobile: `01711-0${String(counter).padStart(5, '0')}`,
        specializations: { therapyTypeIds: [t.OT, t.SLT, t.ABA] },
        availability: {
          days: Array.from({ length: 7 }, (_, dayOfWeek) => ({
            dayOfWeek,
            isAvailable: OPEN_DAYS.includes(dayOfWeek),
            intervals: [{ start: '09:00', end: '17:00' }],
          })),
        },
        membershipId: staffT.membershipId,
      }),
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
      therapist,
      ayaan: await patient('Ayaan Rahman'),
      zara: await patient('Zara Karim'),
    };
  }
  type Setup = Awaited<ReturnType<typeof setup>>;

  const packageBody = (s: Setup, overrides: Record<string, unknown> = {}) => ({
    name: 'OT Monthly',
    therapyTypeIds: [s.t.OT],
    sessionCount: 12,
    price: '9000',
    validityValue: 30,
    validityUnit: 'DAY',
    ...overrides,
  });

  function createPackage(s: Setup, overrides: Record<string, unknown> = {}) {
    return ok<Pkg>(s.admin.post('/packages', packageBody(s, overrides)), 201);
  }

  /** Valid from a week ago, so past sessions can use it. */
  function enroll(
    s: Setup,
    packageId: string,
    overrides: Record<string, unknown> = {},
    browser: Browser = s.admin,
  ) {
    return ok<Enrollment>(
      browser.post('/package-enrollments', {
        patientId: s.ayaan.id,
        packageId,
        activationPolicy: 'FIXED_DATE',
        startDate: daysFromToday(-7),
        ...overrides,
      }),
      201,
    );
  }

  function book(s: Setup, overrides: Record<string, unknown> = {}) {
    return s.admin.post('/appointments', {
      patientId: s.ayaan.id,
      type: 'THERAPY_SESSION',
      therapyTypeId: s.t.OT,
      therapistId: s.therapist.id,
      durationMinutes: 45,
      date: nextWeekday(MON),
      startTime: '10:00',
      ...overrides,
    });
  }

  const enrollment = (s: Setup, id: string) =>
    ok<Enrollment>(s.admin.get(`/package-enrollments/${id}`));

  // ── Catalog ───────────────────────────────────────────────────────────────

  describe('catalog', () => {
    it('creates, lists, edits and duplicates packages with several therapies', async () => {
      const s = await setup();
      const combined = await createPackage(s, {
        name: 'Combined development',
        therapyTypeIds: [s.t.OT, s.t.SLT],
        sessionCount: 10,
        price: 7500.5,
        usageLimitCount: 3,
        usageLimitPeriod: 'WEEK',
      });
      expect(combined).toMatchObject({
        code: 'PKG-0001',
        price: '7500.50',
        sessionCount: 10,
        isActive: true,
      });
      expect(combined.therapyTypes.map((t) => t.code).sort()).toEqual([
        'OT',
        'SLT',
      ]);
      const own = await createPackage(s, {
        code: 'aba-weekly',
        therapyTypeIds: [s.t.ABA],
      });
      expect(own.code).toBe('ABA-WEEKLY');
      const taken = await fails(
        s.admin.post('/packages', packageBody(s, { code: 'ABA-weekly' })),
        400,
      );
      expect(taken.code).toBe('PACKAGE_CODE_TAKEN');

      const bySlt = await ok<{ items: Pkg[] }>(
        s.admin.get(`/packages?therapyTypeId=${s.t.SLT}`),
      );
      expect(bySlt.items.map((p) => p.id)).toEqual([combined.id]);
      const found = await ok<{ items: Pkg[] }>(
        s.admin.get('/packages?search=aba'),
      );
      expect(found.items.map((p) => p.id)).toEqual([own.id]);

      const edited = await ok<Pkg>(
        s.admin.patch(`/packages/${combined.id}`, {
          price: '8000.00',
          therapyTypeIds: [s.t.SLT],
        }),
      );
      expect(edited.price).toBe('8000.00');
      expect(edited.therapyTypes.map((t) => t.code)).toEqual(['SLT']);

      const copy = await ok<Pkg>(
        s.admin.post(`/packages/${combined.id}/duplicate`),
        201,
      );
      expect(copy).toMatchObject({
        code: 'PKG-0002',
        name: 'Combined development (copy)',
        isActive: false,
        price: '8000.00',
      });
    });

    it('validates price, sessions, validity and therapy types', async () => {
      const s = await setup();
      const other = await registerCenter(app);
      const otherTypes = (await other.browser.get('/therapy-types')).body as {
        id: string;
      }[];
      for (const [patch, field] of [
        [{ price: '-1' }, 'price'],
        [{ price: '10.555' }, 'price'],
        [{ price: 0.30000000000000004 }, 'price'],
        [{ sessionCount: 0 }, 'sessionCount'],
        [{ sessionCount: 2.5 }, 'sessionCount'],
        [{ validityValue: 0 }, 'validityValue'],
        [{ validityValue: 200, validityUnit: 'MONTH' }, 'validityValue'],
        [{ therapyTypeIds: [] }, 'therapyTypeIds'],
        [{ therapyTypeIds: [otherTypes[0].id] }, 'therapyTypeIds'],
        [{ usageLimitCount: 2 }, 'usageLimitPeriod'],
      ] as const) {
        const res = await fails(
          s.admin.post('/packages', packageBody(s, patch)),
          400,
        );
        expect(res.errors?.[field]).toBeDefined();
      }
      const free = await createPackage(s, { price: '0' });
      expect(free.price).toBe('0.00');
    });

    it('deletes only unused packages and keeps others for their history', async () => {
      const s = await setup();
      const unused = await createPackage(s);
      await ok(s.admin.delete(`/packages/${unused.id}`), 204);
      await fails(s.admin.get(`/packages/${unused.id}`), 404);

      const used = await createPackage(s);
      await enroll(s, used.id);
      expect(
        (await ok<Pkg>(s.admin.get(`/packages/${used.id}`))).actions.delete,
      ).toBe(false);
      const refused = await fails(s.admin.delete(`/packages/${used.id}`), 409);
      expect(refused.code).toBe('PACKAGE_IN_USE');
    });

    it('stops new enrollments in inactive packages but keeps existing ones', async () => {
      const s = await setup();
      const pkg = await createPackage(s);
      const before = await enroll(s, pkg.id);
      await ok(
        s.admin.patch(`/packages/${pkg.id}/status`, { isActive: false }),
      );
      const refused = await fails(
        s.admin.post('/package-enrollments', {
          patientId: s.ayaan.id,
          packageId: pkg.id,
        }),
        400,
      );
      expect(refused.code).toBe('PACKAGE_INACTIVE');
      expect((await enrollment(s, before.id)).status).toBe('ACTIVE');
      // The existing enrollment can still be booked against.
      await ok(book(s, { packageEnrollmentId: before.id }), 201);
    });
  });

  // ── Enrolling ─────────────────────────────────────────────────────────────

  describe('enrolling', () => {
    it('records the package’s terms and keeps them when the catalog changes', async () => {
      const s = await setup();
      const pkg = await createPackage(s);
      const e = await enroll(
        s,
        pkg.id,
        { activationPolicy: 'ENROLLMENT_DATE' },
        s.desk,
      );
      expect(e).toMatchObject({
        code: 'PE-0001',
        status: 'ACTIVE',
        startDate: daysFromToday(0),
        endDate: daysFromToday(29),
        finalPrice: '9000.00',
        sessions: {
          purchased: 12,
          total: 12,
          consumed: 0,
          reserved: 0,
          remaining: 12,
          availableToBook: 12,
        },
      });
      expect(e.pricing).toMatchObject({
        catalogPrice: '9000.00',
        discountType: 'NONE',
        discountAmount: '0.00',
      });

      await ok(
        s.admin.patch(`/packages/${pkg.id}`, {
          sessionCount: 10,
          price: '10000',
          validityValue: 2,
          validityUnit: 'MONTH',
          name: 'OT Monthly (new)',
        }),
      );
      const after = await enrollment(s, e.id);
      expect(after).toMatchObject({
        endDate: daysFromToday(29),
        finalPrice: '9000.00',
        terms: { sessionCount: 12 },
        package: { name: 'OT Monthly' },
        packageSnapshot: {
          price: '9000.00',
          sessionCount: 12,
          name: 'OT Monthly',
        },
        sessions: { total: 12 },
      });
      // The database refuses changes to agreed terms too.
      await expect(
        prisma.packageEnrollment.update({
          where: { id: e.id },
          data: { finalPrice: '1.00' },
        }),
      ).rejects.toThrow();
    });

    it('applies fixed and percentage discounts in exact decimals, with permission', async () => {
      const s = await setup();
      const pkg = await createPackage(s, { price: '999.99' });
      const fixed = await enroll(
        s,
        pkg.id,
        { discountType: 'FIXED', discountValue: '100' },
        s.manager,
      );
      expect(fixed.pricing).toMatchObject({
        discountType: 'FIXED',
        discountValue: '100.00',
        discountAmount: '100.00',
        finalPrice: '899.99',
      });
      const percent = await enroll(s, pkg.id, {
        discountType: 'PERCENTAGE',
        discountValue: '12.5',
      });
      // 999.99 × 12.5% = 124.99875, rounded to 125.00 off
      expect(percent.pricing).toMatchObject({
        discountValue: '12.50',
        discountAmount: '125.00',
        finalPrice: '874.99',
      });
      const agreed = await enroll(s, pkg.id, {
        discountType: 'PRICE_OVERRIDE',
        agreedPrice: '1200',
        sessionCount: 15,
      });
      expect(agreed).toMatchObject({
        finalPrice: '1200.00',
        sessions: { purchased: 15, total: 15 },
      });

      for (const [patch, field] of [
        [{ discountType: 'FIXED', discountValue: '1000' }, 'discountValue'],
        [{ discountType: 'PERCENTAGE', discountValue: '101' }, 'discountValue'],
        [{ discountType: 'FIXED', discountValue: '-5' }, 'discountValue'],
        [{ discountType: 'PRICE_OVERRIDE' }, 'agreedPrice'],
      ] as const) {
        const res = await fails(
          s.admin.post('/package-enrollments', {
            patientId: s.ayaan.id,
            packageId: pkg.id,
            ...patch,
          }),
          400,
        );
        expect(res.errors?.[field]).toBeDefined();
      }
      // Front desk enrolls on the package's own terms only.
      const desk = await fails(
        s.desk.post('/package-enrollments', {
          patientId: s.ayaan.id,
          packageId: pkg.id,
          discountType: 'FIXED',
          discountValue: '50',
        }),
        403,
      );
      expect(desk.code).toBe('FORBIDDEN');
      await fails(
        s.desk.post('/package-enrollments', {
          patientId: s.ayaan.id,
          packageId: pkg.id,
          sessionCount: 13,
        }),
        403,
      );
    });

    it('computes validity in days, weeks and calendar months, or takes a chosen end date', async () => {
      const s = await setup();
      const month = await createPackage(s, {
        validityValue: 1,
        validityUnit: 'MONTH',
      });
      const weeks = await createPackage(s, {
        validityValue: 4,
        validityUnit: 'WEEK',
      });
      const start = daysFromToday(10);
      const m = await enroll(s, month.id, { startDate: start });
      const w = await enroll(s, weeks.id, { startDate: start });
      // Starting in the future: not active yet.
      expect(m.status).toBe('PENDING');
      expect(w.endDate).toBe(daysFromToday(10 + 27));
      // A calendar month from the 1st runs to that month's last day.
      const t = today();
      const first = new Date(
        Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1),
      );
      const lastDay = new Date(
        Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 2, 0),
      );
      const fromFirst = await enroll(s, month.id, { startDate: iso(first) });
      expect(fromFirst.endDate).toBe(iso(lastDay));
      expect(m.endDate).not.toBe(m.startDate);
      const custom = await enroll(s, weeks.id, {
        startDate: start,
        endDate: daysFromToday(60),
      });
      expect(custom).toMatchObject({
        endDate: daysFromToday(60),
        customEndDate: true,
      });
      const before = await fails(
        s.admin.post('/package-enrollments', {
          patientId: s.ayaan.id,
          packageId: weeks.id,
          activationPolicy: 'FIXED_DATE',
          startDate: start,
          endDate: daysFromToday(5),
        }),
        400,
      );
      expect(before.errors?.endDate).toBeDefined();
    });

    it('validates the patient, therapy plan and tenant of an enrollment', async () => {
      const s = await setup();
      const pkg = await createPackage(s);
      const other = await registerCenter(app);
      const foreign = await fails(
        other.browser.post('/package-enrollments', {
          patientId: s.ayaan.id,
          packageId: pkg.id,
        }),
        400,
      );
      expect(foreign.code).toBe('PATIENT_NOT_FOUND');
      await fails(other.browser.get(`/packages/${pkg.id}`), 404);
      const plan = await fails(
        s.admin.post('/package-enrollments', {
          patientId: s.ayaan.id,
          packageId: pkg.id,
          therapyPlanId: pkg.id,
        }),
        400,
      );
      expect(plan.code).toBe('THERAPY_PLAN_NOT_FOUND');
    });

    it('records the same purchase once when it’s sent twice', async () => {
      const s = await setup();
      const pkg = await createPackage(s);
      const requestId = '6f1c1d3e-2b1a-4c5d-9e8f-0a1b2c3d4e5f';
      const [a, b] = await Promise.all([
        enroll(s, pkg.id, { requestId }),
        enroll(s, pkg.id, { requestId }).catch(() => null),
      ]);
      const again = await enroll(s, pkg.id, { requestId });
      expect(again.id).toBe(a.id);
      if (b) expect(b.id).toBe(a.id);
      expect(await prisma.packageEnrollment.count()).toBe(1);
    });
  });

  // ── Sessions ──────────────────────────────────────────────────────────────

  describe('sessions', () => {
    it('reserves on booking, releases on cancelling and consumes on completing', async () => {
      const s = await setup();
      const pkg = await createPackage(s);
      const e = await enroll(s, pkg.id);
      const upcoming = await ok<Appointment>(
        book(s, { packageEnrollmentId: e.id }),
        201,
      );
      expect(upcoming).toMatchObject({
        packageEnrollmentId: e.id,
        package: { enrollmentId: e.id, coverage: 'HELD' },
      });
      expect((await enrollment(s, e.id)).sessions).toMatchObject({
        reserved: 1,
        consumed: 0,
        remaining: 12,
        availableToBook: 11,
      });

      const cancelled = await ok<Appointment>(
        s.admin.patch(`/appointments/${upcoming.id}/cancel`, {
          reason: 'PATIENT_REQUEST',
        }),
      );
      expect(cancelled.package).toMatchObject({
        coverage: 'RELEASED',
        releaseReason: 'APPOINTMENT_CANCELLED',
      });
      expect((await enrollment(s, e.id)).sessions).toMatchObject({
        reserved: 0,
        availableToBook: 12,
      });

      const past = await ok<Appointment>(
        book(s, { packageEnrollmentId: e.id, date: recentWorkday(1) }),
        201,
      );
      const done = await ok<Appointment>(
        s.admin.patch(`/appointments/${past.id}/status`, {
          status: 'COMPLETED',
          attendance: 'PRESENT',
        }),
      );
      expect(done.package).toMatchObject({
        coverage: 'CHARGED',
        chargeReason: 'COMPLETED',
      });
      const after = await enrollment(s, e.id);
      expect(after.sessions).toMatchObject({
        purchased: 12,
        consumed: 1,
        reserved: 0,
        remaining: 11,
        availableToBook: 11,
      });

      const ledger = await ok<{ items: Movement[] }>(
        s.admin.get(`/package-enrollments/${e.id}/ledger`),
      );
      expect(ledger.items.map((m) => m.type)).toEqual([
        'INITIAL_ALLOCATION',
        'SESSION_RESERVED',
        'RESERVATION_RELEASED',
        'SESSION_RESERVED',
        'SESSION_CONSUMPTION',
      ]);

      // A second consumption for the same appointment is refused by the database.
      await expect(
        prisma.packageSessionLedger.create({
          data: {
            centerId: s.center.id,
            enrollmentId: e.id,
            movement: 'SESSION_CONSUMPTION',
            quantity: -1,
            appointmentId: past.id,
            chargeReason: 'COMPLETED',
            createdById: (await prisma.user.findFirstOrThrow()).id,
          },
        }),
      ).rejects.toThrow();
      // Ledger entries are append-only.
      await expect(
        prisma.packageSessionLedger.deleteMany({
          where: { enrollmentId: e.id },
        }),
      ).rejects.toThrow();
    });

    it('refuses sessions the enrollment doesn’t cover', async () => {
      const s = await setup();
      const pkg = await createPackage(s, { validityValue: 10 });
      const e = await enroll(s, pkg.id);
      const zara = await enroll(s, pkg.id, { patientId: s.zara.id });
      const cases: [Record<string, unknown>, string][] = [
        [
          { therapyTypeId: s.t.SLT, durationMinutes: 30 },
          'THERAPY_NOT_COVERED',
        ],
        [{ type: 'ASSESSMENT', durationMinutes: 60 }, 'ASSESSMENT_NOT_COVERED'],
        [{ date: nextWeekday(TUE, 5) }, 'AFTER_END'],
        [{ packageEnrollmentId: zara.id }, 'OTHER_PATIENT'],
      ];
      for (const [patch, reason] of cases) {
        const res = await fails(
          book(s, { packageEnrollmentId: e.id, ...patch }),
          409,
        );
        expect(res.code).toBe('PACKAGE_NOT_APPLICABLE');
        expect(res.problems?.map((p) => p.reason)).toContain(reason);
      }
      expect(await prisma.appointment.count()).toBe(0);
    });

    it('never books more sessions than are left, even concurrently', async () => {
      const s = await setup();
      const pkg = await createPackage(s, { sessionCount: 1 });
      const e = await enroll(s, pkg.id);
      const results = await Promise.all(
        ['10:00', '12:00', '14:00'].map((startTime) =>
          book(s, { packageEnrollmentId: e.id, startTime }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      const refused = results.find((r) => r.status === 409)!;
      expect(refused.body.problems[0].reason).toBe('NO_SESSIONS');
      expect((await enrollment(s, e.id)).sessions).toMatchObject({
        reserved: 1,
        availableToBook: 0,
      });
      // The balance CHECK holds even if a write slipped past the service.
      const unpaid = await ok<Appointment>(
        book(s, { startTime: '16:00' }),
        201,
      );
      await expect(
        prisma.packageSessionReservation.create({
          data: {
            centerId: s.center.id,
            enrollmentId: e.id,
            appointmentId: unpaid.id,
            sessionDate: new Date(`${nextWeekday(MON)}T00:00:00Z`),
            createdById: (await prisma.user.findFirstOrThrow()).id,
          },
        }),
      ).rejects.toThrow(/PackageEnrollment_balance_check/);
    });

    it('books a recurring series against a package all or nothing', async () => {
      const s = await setup();
      const pkg = await createPackage(s, { sessionCount: 3 });
      const e = await enroll(s, pkg.id);
      const series = (count: number) =>
        s.admin.post('/appointment-series', {
          patientId: s.ayaan.id,
          type: 'THERAPY_SESSION',
          therapyTypeId: s.t.OT,
          therapistId: s.therapist.id,
          durationMinutes: 45,
          startTime: '15:00',
          packageEnrollmentId: e.id,
          recurrence: {
            frequency: 'WEEKLY',
            interval: 1,
            daysOfWeek: [MON],
            startDate: daysFromToday(1),
            endType: 'COUNT',
            count,
          },
        });
      const tooMany = await fails(series(4), 409);
      expect(tooMany.code).toBe('PACKAGE_NOT_APPLICABLE');
      expect(await prisma.appointment.count()).toBe(0);
      await ok(series(3), 201);
      expect((await enrollment(s, e.id)).sessions).toMatchObject({
        reserved: 3,
        availableToBook: 0,
      });
      const cut = await ok<{ cancelled: number }>(
        s.admin.post(
          `/appointment-series/${(await prisma.appointmentSeries.findFirstOrThrow()).id}/cancel-future`,
          { reason: 'PATIENT_REQUEST' },
        ),
      );
      expect(cut.cancelled).toBe(3);
      expect((await enrollment(s, e.id)).sessions.reserved).toBe(0);
    });

    it('moves the held session with a reschedule, or takes the package off', async () => {
      const s = await setup();
      const pkg = await createPackage(s, { validityValue: 10 });
      const e = await enroll(s, pkg.id);
      const a = await ok<Appointment>(
        book(s, { packageEnrollmentId: e.id }),
        201,
      );
      const moved = await ok<Appointment>(
        s.admin.patch(`/appointments/${a.id}/reschedule`, {
          date: nextWeekday(MON),
          startTime: '11:00',
        }),
      );
      expect(moved.package?.coverage).toBe('HELD');
      expect((await enrollment(s, e.id)).sessions.reserved).toBe(1);

      const late = { date: nextWeekday(TUE, 5), startTime: '10:00' };
      const refused = await fails(
        s.admin.patch(`/appointments/${a.id}/reschedule`, late),
        409,
      );
      expect(refused).toMatchObject({
        code: 'PACKAGE_NOT_APPLICABLE',
        removable: true,
      });
      const without = await ok<Appointment>(
        s.admin.patch(`/appointments/${a.id}/reschedule`, {
          ...late,
          packageEnrollmentId: null,
        }),
      );
      expect(without).toMatchObject({
        packageEnrollmentId: null,
        package: null,
      });
      expect((await enrollment(s, e.id)).sessions.reserved).toBe(0);

      // And on again, via its own endpoint, once it's back inside the validity.
      await ok(
        s.admin.patch(`/appointments/${a.id}/reschedule`, {
          date: nextWeekday(MON),
          startTime: '12:00',
        }),
      );
      const back = await ok<Appointment>(
        s.admin.patch(`/appointments/${a.id}/package`, {
          packageEnrollmentId: e.id,
        }),
      );
      expect(back.package?.coverage).toBe('HELD');
    });

    it('charges no-shows and late cancellations only when the package says so', async () => {
      const s = await setup();
      await ok(
        s.admin.patch('/settings/scheduling', {
          cancellationCutoffMinutes: 43_200,
        }),
      );
      const lenient = await enroll(s, (await createPackage(s)).id);
      const strict = await enroll(
        s,
        (
          await createPackage(s, {
            chargeNoShow: true,
            chargeLateCancellation: true,
          })
        ).id,
      );
      const noShow = async (e: Enrollment, startTime: string) => {
        const a = await ok<Appointment>(
          book(s, {
            packageEnrollmentId: e.id,
            date: recentWorkday(1),
            startTime,
          }),
          201,
        );
        return ok<Appointment>(
          s.admin.patch(`/appointments/${a.id}/status`, { status: 'NO_SHOW' }),
        );
      };
      expect((await noShow(lenient, '09:00')).package).toMatchObject({
        coverage: 'RELEASED',
        releaseReason: 'NO_SHOW_NOT_CHARGED',
      });
      expect((await noShow(strict, '10:00')).package).toMatchObject({
        coverage: 'CHARGED',
        chargeReason: 'NO_SHOW',
      });
      const lateCancel = async (e: Enrollment, startTime: string) => {
        const a = await ok<Appointment>(
          book(s, { packageEnrollmentId: e.id, startTime }),
          201,
        );
        return ok<Appointment>(
          s.admin.patch(`/appointments/${a.id}/cancel`, {
            reason: 'PATIENT_REQUEST',
          }),
        );
      };
      expect((await lateCancel(lenient, '11:00')).package?.coverage).toBe(
        'RELEASED',
      );
      expect((await lateCancel(strict, '12:00')).package).toMatchObject({
        coverage: 'CHARGED',
        chargeReason: 'LATE_CANCELLATION',
      });
      expect((await enrollment(s, strict.id)).sessions.consumed).toBe(2);
      expect((await enrollment(s, lenient.id)).sessions.consumed).toBe(0);
    });

    it('enforces an optional usage limit per period', async () => {
      const s = await setup();
      const pkg = await createPackage(s, {
        usageLimitCount: 1,
        usageLimitPeriod: 'DAY',
      });
      const e = await enroll(s, pkg.id);
      await ok(book(s, { packageEnrollmentId: e.id, startTime: '10:00' }), 201);
      const res = await fails(
        book(s, { packageEnrollmentId: e.id, startTime: '14:00' }),
        409,
      );
      expect(res.problems?.map((p) => p.reason)).toEqual(['USAGE_LIMIT']);
      await ok(
        book(s, {
          packageEnrollmentId: e.id,
          date: nextWeekday(TUE),
          startTime: '14:00',
        }),
        201,
      );
    });

    it('activates a first-session enrollment on the first charged session', async () => {
      const s = await setup();
      const pkg = await createPackage(s, {
        activationPolicy: 'FIRST_SESSION',
        validityValue: 30,
      });
      const e = await enroll(s, pkg.id, {
        activationPolicy: undefined,
        startDate: undefined,
      });
      expect(e).toMatchObject({
        status: 'PENDING',
        startDate: null,
        endDate: null,
      });
      const day = recentWorkday(2);
      const a = await ok<Appointment>(
        book(s, { packageEnrollmentId: e.id, date: day }),
        201,
      );
      // Still pending while only held.
      expect((await enrollment(s, e.id)).status).toBe('PENDING');
      await ok(
        s.admin.patch(`/appointments/${a.id}/status`, {
          status: 'COMPLETED',
          attendance: 'PRESENT',
        }),
      );
      const active = await enrollment(s, e.id);
      const start = new Date(`${day}T00:00:00Z`);
      expect(active).toMatchObject({
        status: 'ACTIVE',
        startDate: day,
        endDate: iso(addDays(start, 29)),
      });
    });

    it('shows therapists which package covers their session, without prices', async () => {
      const s = await setup();
      const e = await enroll(s, (await createPackage(s)).id);
      const a = await ok<Appointment>(
        book(s, { packageEnrollmentId: e.id }),
        201,
      );
      const seen = await ok<Appointment & Record<string, unknown>>(
        s.therapistUser.get(`/appointments/${a.id}`),
      );
      expect(seen.package).toMatchObject({ coverage: 'HELD' });
      expect(JSON.stringify(seen.package)).not.toContain('9000');
      await fails(s.therapistUser.get('/packages'), 403);
      await fails(s.therapistUser.get(`/package-enrollments/${e.id}`), 403);
    });
  });

  // ── Changes ───────────────────────────────────────────────────────────────

  describe('adjustments, renewal and cancellation', () => {
    it('reverses a consumption as a new movement, once', async () => {
      const s = await setup();
      const e = await enroll(s, (await createPackage(s)).id);
      const a = await ok<Appointment>(
        book(s, { packageEnrollmentId: e.id, date: recentWorkday(1) }),
        201,
      );
      const done = await ok<Appointment>(
        s.admin.patch(`/appointments/${a.id}/status`, {
          status: 'COMPLETED',
          attendance: 'PRESENT',
        }),
      );
      const consumptionId = done.package!.consumptionId!;
      const reversal = {
        type: 'CONSUMPTION_REVERSAL',
        consumptionId,
        reason: 'Charged by mistake',
      };
      const after = await ok<Enrollment>(
        s.manager.post(`/package-enrollments/${e.id}/adjust`, reversal),
      );
      expect(after.sessions).toMatchObject({
        consumed: 0,
        remaining: 12,
        reversed: 1,
      });
      const again = await fails(
        s.manager.post(`/package-enrollments/${e.id}/adjust`, reversal),
        409,
      );
      expect(again.code).toBe('ALREADY_REVERSED');
      const ledger = await ok<{ items: Movement[] }>(
        s.admin.get(`/package-enrollments/${e.id}/ledger`),
      );
      const consumption = ledger.items.find(
        (m) => m.type === 'SESSION_CONSUMPTION',
      );
      expect(consumption).toMatchObject({ reversed: true, quantity: -1 });
      expect(ledger.items.at(-1)).toMatchObject({
        type: 'CONSUMPTION_REVERSAL',
        quantity: 1,
        reason: 'Charged by mistake',
      });
      expect(
        (await ok<Appointment>(s.admin.get(`/appointments/${a.id}`))).package
          ?.coverage,
      ).toBe('REVERSED');
    });

    it('credits and debits with a reason, never below what’s booked, once per request', async () => {
      const s = await setup();
      const e = await enroll(
        s,
        (await createPackage(s, { sessionCount: 2 })).id,
      );
      await ok(book(s, { packageEnrollmentId: e.id }), 201);
      const requestId = '0b8c3f4e-1a2b-4c3d-8e9f-112233445566';
      const bonus = {
        type: 'BONUS_CREDIT',
        quantity: 2,
        reason: 'Goodwill',
        requestId,
      };
      await ok(s.manager.post(`/package-enrollments/${e.id}/adjust`, bonus));
      const same = await ok<Enrollment>(
        s.manager.post(`/package-enrollments/${e.id}/adjust`, bonus),
      );
      expect(same.sessions).toMatchObject({
        purchased: 2,
        total: 4,
        additionalCredits: 2,
        availableToBook: 3,
      });
      const tooMuch = await fails(
        s.manager.post(`/package-enrollments/${e.id}/adjust`, {
          type: 'MANUAL_DEBIT',
          quantity: 4,
          reason: 'Correction',
        }),
        409,
      );
      expect(tooMuch.code).toBe('PACKAGE_DEBIT_TOO_LARGE');
      // Two concurrent debits of the last free sessions: only one fits.
      const debits = await Promise.all(
        [2, 2].map((quantity) =>
          s.manager.post(`/package-enrollments/${e.id}/adjust`, {
            type: 'MANUAL_DEBIT',
            quantity,
            reason: 'Correction',
          }),
        ),
      );
      expect(debits.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await enrollment(s, e.id)).sessions).toMatchObject({
        total: 2,
        manualDebits: 2,
        reserved: 1,
        availableToBook: 1,
      });
      const noReason = await fails(
        s.manager.post(`/package-enrollments/${e.id}/adjust`, {
          type: 'MANUAL_CREDIT',
          quantity: 1,
        }),
        400,
      );
      expect(noReason.errors?.reason).toBeDefined();
      await fails(
        s.desk.post(`/package-enrollments/${e.id}/adjust`, {
          type: 'MANUAL_CREDIT',
          quantity: 1,
          reason: 'Front desk',
        }),
        403,
      );
    });

    it('renews as a new enrollment and leaves the old one as it was', async () => {
      const s = await setup();
      const pkg = await createPackage(s);
      const first = await enroll(s, pkg.id);
      await ok(
        book(s, { packageEnrollmentId: first.id, date: recentWorkday(1) }),
        201,
      );
      await ok(s.admin.patch(`/packages/${pkg.id}`, { price: '9500' }));
      const renewed = await ok<Enrollment>(
        s.desk.post(`/package-enrollments/${first.id}/renew`, {
          activationPolicy: 'FIXED_DATE',
          startDate: first.endDate
            ? iso(addDays(new Date(`${first.endDate}T00:00:00Z`), 1))
            : undefined,
        }),
        201,
      );
      expect(renewed).toMatchObject({
        renewedFromId: first.id,
        finalPrice: '9500.00',
        status: 'PENDING',
        sessions: { total: 12, reserved: 0 },
      });
      const old = await enrollment(s, first.id);
      expect(old).toMatchObject({
        finalPrice: '9000.00',
        sessions: { reserved: 1 },
      });
      expect(old.renewals.map((r) => r.id)).toEqual([renewed.id]);
      const listed = await ok<{ patient: { id: string }; items: Enrollment[] }>(
        s.desk.get(`/patients/${s.ayaan.id}/package-enrollments`),
      );
      expect(listed.items.map((i) => i.id)).toEqual([renewed.id, first.id]);
    });

    it('cancels an enrollment, giving back held sessions and keeping its history', async () => {
      const s = await setup();
      const e = await enroll(s, (await createPackage(s)).id);
      const past = await ok<Appointment>(
        book(s, { packageEnrollmentId: e.id, date: recentWorkday(1) }),
        201,
      );
      await ok(
        s.admin.patch(`/appointments/${past.id}/status`, {
          status: 'COMPLETED',
          attendance: 'PRESENT',
        }),
      );
      const upcoming = await ok<Appointment>(
        book(s, { packageEnrollmentId: e.id }),
        201,
      );
      await fails(
        s.desk.post(`/package-enrollments/${e.id}/cancel`, {
          reason: 'Moved away',
        }),
        403,
      );
      const cancelled = await ok<Enrollment>(
        s.manager.post(`/package-enrollments/${e.id}/cancel`, {
          reason: 'Moved away',
        }),
      );
      expect(cancelled).toMatchObject({
        status: 'CANCELLED',
        sessions: { consumed: 1, reserved: 0 },
        actions: { cancel: false },
      });
      const still = await ok<Appointment>(
        s.admin.get(`/appointments/${upcoming.id}`),
      );
      expect(still).toMatchObject({
        status: 'SCHEDULED',
        package: {
          coverage: 'RELEASED',
          releaseReason: 'ENROLLMENT_CANCELLED',
        },
      });
      const refused = await fails(
        book(s, { packageEnrollmentId: e.id, startTime: '15:00' }),
        409,
      );
      expect(refused.problems?.[0].reason).toBe('CANCELLED');
      const ledger = await ok<{ items: Movement[] }>(
        s.admin.get(`/package-enrollments/${e.id}/ledger`),
      );
      expect(
        ledger.items.filter((m) => m.type === 'SESSION_CONSUMPTION'),
      ).toHaveLength(1);
      await fails(
        s.manager.post(`/package-enrollments/${e.id}/cancel`, {
          reason: 'Again',
        }),
        409,
      );
    });
  });

  // ── Lists, options and isolation ──────────────────────────────────────────

  describe('lists and isolation', () => {
    it('filters enrollments by derived status, therapy and search', async () => {
      const s = await setup();
      const ot = await createPackage(s);
      const slt = await createPackage(s, {
        name: 'SLT Monthly',
        therapyTypeIds: [s.t.SLT],
        sessionCount: 1,
      });
      const active = await enroll(s, ot.id);
      const expired = await enroll(s, ot.id, { startDate: daysFromToday(-60) });
      const pending = await enroll(s, ot.id, {
        startDate: daysFromToday(5),
        patientId: s.zara.id,
      });
      const exhausted = await enroll(s, slt.id);
      const a = await ok<Appointment>(
        book(s, {
          packageEnrollmentId: exhausted.id,
          therapyTypeId: s.t.SLT,
          durationMinutes: 30,
          date: recentWorkday(1),
        }),
        201,
      );
      await ok(
        s.admin.patch(`/appointments/${a.id}/status`, {
          status: 'COMPLETED',
          attendance: 'PRESENT',
        }),
      );
      const ids = async (q: string) =>
        (
          await ok<{ items: Enrollment[] }>(
            s.desk.get(`/package-enrollments?${q}`),
          )
        ).items
          .map((i) => i.id)
          .sort();
      expect(await ids('status=ACTIVE')).toEqual([active.id]);
      expect(await ids('status=EXPIRED')).toEqual([expired.id]);
      expect(await ids('status=PENDING')).toEqual([pending.id]);
      expect(await ids('status=EXHAUSTED')).toEqual([exhausted.id]);
      expect(await ids('status=ACTIVE,PENDING')).toEqual(
        [active.id, pending.id].sort(),
      );
      expect(await ids(`therapyTypeId=${s.t.SLT}`)).toEqual([exhausted.id]);
      expect(await ids('search=Zara')).toEqual([pending.id]);
      expect(await ids(`search=${exhausted.code}`)).toEqual([exhausted.id]);
      expect(await ids('expiringSoon=true')).toEqual([]);

      const options = await ok<{
        items: (Enrollment & { eligible: boolean })[];
      }>(
        s.desk.get(
          `/package-enrollments/options?patientId=${s.ayaan.id}&therapyTypeId=${s.t.OT}&type=THERAPY_SESSION&date=${nextWeekday(MON)}`,
        ),
      );
      expect(options.items.map((o) => [o.id, o.eligible])).toEqual([
        [active.id, true],
      ]);
    });

    it('keeps each center’s packages and enrollments to itself', async () => {
      const s = await setup();
      const e = await enroll(s, (await createPackage(s)).id);
      const other = await registerCenter(app);
      await fails(other.browser.get(`/package-enrollments/${e.id}`), 404);
      await fails(
        other.browser.get(`/package-enrollments/${e.id}/ledger`),
        404,
      );
      await fails(
        other.browser.post(`/package-enrollments/${e.id}/cancel`, {
          reason: 'Not mine',
        }),
        404,
      );
      await fails(
        other.browser.post(`/package-enrollments/${e.id}/renew`, {}),
        404,
      );
      expect(
        (
          await ok<{ items: unknown[] }>(
            other.browser.get('/package-enrollments'),
          )
        ).items,
      ).toEqual([]);
      // Booking another center's patient with this center's package fails before any write.
      const types = (await other.browser.get('/therapy-types')).body as {
        id: string;
        code: string;
      }[];
      const otherPatient = await ok<{ id: string }>(
        other.browser.post('/patients', {
          fullName: 'Rafi Ahmed',
          contact: {
            contactType: 'GUARDIAN',
            fullName: 'Rina Ahmed',
            mobile: '01911-000111',
            relationship: 'MOTHER',
          },
        }),
        201,
      );
      const otherTherapist = await ok<{ id: string }>(
        other.browser.post('/therapists', {
          fullName: 'Kamal Hossain',
          mobile: '01711-999888',
          specializations: {
            therapyTypeIds: [types.find((t) => t.code === 'OT')!.id],
          },
          availability: {
            days: Array.from({ length: 7 }, (_, dayOfWeek) => ({
              dayOfWeek,
              isAvailable: OPEN_DAYS.includes(dayOfWeek),
              intervals: [{ start: '09:00', end: '17:00' }],
            })),
          },
        }),
        201,
      );
      const res = await fails(
        other.browser.post('/appointments', {
          patientId: otherPatient.id,
          type: 'THERAPY_SESSION',
          therapyTypeId: types.find((t) => t.code === 'OT')!.id,
          therapistId: otherTherapist.id,
          durationMinutes: 45,
          date: nextWeekday(MON),
          startTime: '10:00',
          packageEnrollmentId: e.id,
        }),
        400,
      );
      expect(res.code).toBe('PACKAGE_NOT_FOUND');
      expect(await prisma.appointment.count()).toBe(0);
      expect((await enrollment(s, e.id)).sessions.reserved).toBe(0);
    });
  });
});
