import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

import {
  addDays,
  formatIsoDate,
  parseIsoDate,
  todayIn,
} from '../src/common/time';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  Browser,
  FakeMail,
  addStaff,
  createTestApp,
  registerCenter,
  resetDatabase,
} from './helpers';

interface Conflict {
  reason: string;
  message: string;
  appointmentId?: string;
}

interface Item {
  id: string;
  seriesId: string | null;
  type: string;
  status: string;
  startAt: string;
  endAt: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  allowOverlap: boolean;
  lateCancellation: boolean;
  patient: { id: string; fullName: string };
  therapist: { id: string; fullName: string; isYou: boolean };
  therapyType: { id: string; code: string };
  actions: Record<string, boolean>;
}

interface Detail extends Item {
  internalNotes: string | null;
  primaryContact: { name: string; mobile: string } | null;
  series: { id: string; position: { index: number; total: number } } | null;
  history: {
    action: string;
    previousValues: Record<string, unknown> | null;
    newValues: Record<string, unknown> | null;
    reason: string | null;
    performedBy: { fullName: string };
  }[];
}

interface Occurrence {
  date: string;
  startTime: string;
  startAt: string;
  adjusted: boolean;
  available: boolean;
  conflicts: Conflict[];
}

const SAT = 6;
const SUN = 0;
const MON = 1;
const WED = 3;
const FRI = 5;
const OPEN_DAYS = [SAT, SUN, MON, 2, WED, 4];

/** A week from the editor with the same intervals on the given days; other days off. */
function week(days: number[], intervals: [string, string][]) {
  return {
    days: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      isAvailable: days.includes(dayOfWeek),
      intervals: intervals.map(([start, end]) => ({ start, end })),
    })),
  };
}

const today = () => todayIn('Asia/Dhaka');
const iso = formatIsoDate;

/** The first date at least `from` days ahead (in Dhaka) that falls on `dayOfWeek`. */
function nextWeekday(dayOfWeek: number, from = 7) {
  let date = addDays(today(), from);
  while (date.getUTCDay() !== dayOfWeek) date = addDays(date, 1);
  return date;
}

/** The most recent date at least `from` days back that the center and therapist work. */
function recentWorkday(from = 1) {
  let date = addDays(today(), -from);
  while (!OPEN_DAYS.includes(date.getUTCDay())) date = addDays(date, -1);
  return date;
}

const mother = {
  contactType: 'GUARDIAN',
  fullName: 'Nasrin Akter',
  mobile: '01711-222333',
  relationship: 'MOTHER',
};

describe('Appointments (e2e)', () => {
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

  async function createTherapist(
    admin: Browser,
    types: string[],
    body: object = {},
  ) {
    return ok<{ id: string; fullName: string }>(
      admin.post('/therapists', {
        fullName: 'Therapist A',
        mobile: '01711-000111',
        specializations: { therapyTypeIds: types },
        // Two shifts, like the module brief: 09–13 and 14–17.
        availability: week(OPEN_DAYS, [
          ['09:00', '13:00'],
          ['14:00', '17:00'],
        ]),
        ...body,
      }),
      201,
    );
  }

  async function createPatient(
    admin: Browser,
    fullName = 'Ayaan Rahman',
    mobile = mother.mobile,
  ) {
    return ok<{ id: string; fullName: string; code: string }>(
      admin.post('/patients', { fullName, contact: { ...mother, mobile } }),
      201,
    );
  }

  /** A center with OT/ABA/SLT, one OT+ABA therapist, one patient, 30-minute slots. */
  async function setup() {
    const center = await registerCenter(app);
    const admin = center.browser;
    const list = (await admin.get('/therapy-types')).body as {
      id: string;
      code: string;
    }[];
    const t = Object.fromEntries(list.map((x) => [x.code, x.id]));
    await ok(admin.patch('/settings/scheduling', { slotIntervalMinutes: 30 }));
    const therapist = await createTherapist(admin, [t.OT, t.ABA]);
    const patient = await createPatient(admin);
    return { ...center, admin, t, therapist, patient };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;

  function booking(s: Setup, overrides: Record<string, unknown> = {}) {
    return {
      patientId: s.patient.id,
      type: 'THERAPY_SESSION',
      therapyTypeId: s.t.OT,
      therapistId: s.therapist.id,
      durationMinutes: 45,
      date: iso(nextWeekday(MON)),
      startTime: '10:00',
      ...overrides,
    };
  }

  const book = (
    s: Setup,
    overrides: Record<string, unknown> = {},
    as = s.admin,
  ) => as.post('/appointments', booking(s, overrides));

  const conflictReasons = (body: unknown) =>
    ((body as { conflicts: Conflict[] }).conflicts ?? []).map((c) => c.reason);

  function series(
    s: Setup,
    recurrence: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      patientId: s.patient.id,
      type: 'THERAPY_SESSION',
      therapyTypeId: s.t.OT,
      therapistId: s.therapist.id,
      durationMinutes: 45,
      startTime: '10:00',
      recurrence: { frequency: 'WEEKLY', interval: 1, ...recurrence },
      ...overrides,
    };
  }

  // ── Single booking ────────────────────────────────────────────────────────

  describe('single booking', () => {
    it('books an appointment and shows it everywhere it belongs', async () => {
      const s = await setup();
      const date = iso(nextWeekday(MON));
      const appt = await ok<Detail>(
        book(s, {
          date,
          type: 'ASSESSMENT',
          durationMinutes: 60,
          internalNotes: 'First visit',
        }),
        201,
      );
      expect(appt).toMatchObject({
        type: 'ASSESSMENT',
        status: 'SCHEDULED',
        date,
        startTime: '10:00',
        endTime: '11:00',
        durationMinutes: 60,
        internalNotes: 'First visit',
        seriesId: null,
        patient: { id: s.patient.id, fullName: 'Ayaan Rahman' },
        therapist: { id: s.therapist.id },
        therapyType: { code: 'OT' },
        primaryContact: { name: 'Nasrin Akter', mobile: '01711222333' },
        actions: {
          confirm: true,
          cancel: true,
          reschedule: true,
          complete: false,
        },
      });
      // Asia/Dhaka is UTC+6.
      expect(appt.startAt).toBe(`${date}T04:00:00.000Z`);
      expect(appt.history.map((h) => h.action)).toEqual(['CREATED']);

      const list = await ok<{ items: Item[]; total: number }>(
        s.admin.get('/appointments'),
      );
      expect(list.items.map((i) => i.id)).toEqual([appt.id]);
      const cal = await ok<{ appointments: Item[]; days: { date: string }[] }>(
        s.admin.get(`/appointments/calendar?startDate=${date}&endDate=${date}`),
      );
      expect(cal.appointments.map((i) => i.id)).toEqual([appt.id]);

      // Therapist profile: upcoming count and schedule overview include it.
      const profile = await ok<{ upcomingAppointments: number }>(
        s.admin.get(`/therapists/${s.therapist.id}`),
      );
      expect(profile.upcomingAppointments).toBe(1);
      const schedule = await ok<{
        appointmentsIncluded: boolean;
        days: {
          appointments: {
            id: string;
            start: string;
            patient: { fullName: string };
          }[];
        }[];
      }>(
        s.admin.get(
          `/therapists/${s.therapist.id}/schedule?startDate=${date}&endDate=${date}`,
        ),
      );
      expect(schedule.appointmentsIncluded).toBe(true);
      expect(schedule.days[0].appointments).toMatchObject([
        { id: appt.id, start: '10:00', patient: { fullName: 'Ayaan Rahman' } },
      ]);

      // Patient history: upcoming now, nothing past yet.
      const upcoming = await ok<{ total: number }>(
        s.admin.get(
          `/appointments?patientId=${s.patient.id}&timeframe=upcoming`,
        ),
      );
      const past = await ok<{ total: number }>(
        s.admin.get(`/appointments?patientId=${s.patient.id}&timeframe=past`),
      );
      expect([upcoming.total, past.total]).toEqual([1, 0]);
    });

    it('rejects unknown and inactive patients', async () => {
      const s = await setup();
      const missing = await book(s, {
        patientId: '00000000-0000-4000-8000-000000000000',
      });
      expect(missing.status).toBe(400);
      expect(missing.body).toMatchObject({
        code: 'PATIENT_NOT_FOUND',
        errors: { patientId: expect.any(String) },
      });

      await ok(
        s.admin.patch(`/patients/${s.patient.id}/status`, {
          status: 'INACTIVE',
        }),
      );
      const inactive = await book(s);
      expect(inactive.status).toBe(400);
      expect(inactive.body.code).toBe('PATIENT_INACTIVE');
    });

    it('rejects inactive therapists and therapists without the specialization', async () => {
      const s = await setup();
      const wrongType = await book(s, {
        therapyTypeId: s.t.SLT,
        durationMinutes: 30,
      });
      expect(wrongType.status).toBe(400);
      expect(wrongType.body.code).toBe('THERAPIST_NOT_SPECIALIZED');

      await ok(
        s.admin.patch(`/therapists/${s.therapist.id}/status`, {
          status: 'INACTIVE',
        }),
      );
      const inactive = await book(s);
      expect(inactive.status).toBe(400);
      expect(inactive.body.code).toBe('THERAPIST_INACTIVE');
    });

    it('enforces the therapy type’s durations unless custom lengths are allowed', async () => {
      const s = await setup();
      const odd = await book(s, { durationMinutes: 50 });
      expect(odd.status).toBe(400);
      expect(odd.body).toMatchObject({
        code: 'DURATION_NOT_ALLOWED',
        errors: { durationMinutes: expect.stringContaining('30, 45, 60') },
      });

      await ok(
        s.admin.patch('/settings/scheduling', { allowCustomDuration: true }),
      );
      const custom = await ok<Detail>(book(s, { durationMinutes: 50 }), 201);
      expect(custom).toMatchObject({ durationMinutes: 50, endTime: '10:50' });
    });

    it('rejects times outside working hours, during time off and on closures', async () => {
      const s = await setup();
      const date = iso(nextWeekday(MON));
      const early = await book(s, { date, startTime: '08:00' });
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('APPOINTMENT_CONFLICT');
      expect(conflictReasons(early.body)).toEqual(
        expect.arrayContaining([
          'OUTSIDE_REGULAR_HOURS',
          'OUTSIDE_CENTER_HOURS',
        ]),
      );
      // Across the therapist's 13:00–14:00 break.
      const lunch = await book(s, { date, startTime: '12:30' });
      expect(conflictReasons(lunch.body)).toEqual(['OUTSIDE_REGULAR_HOURS']);

      await ok(
        s.admin.post(`/therapists/${s.therapist.id}/time-off`, {
          startDate: date,
          endDate: date,
        }),
        201,
      );
      const away = await book(s, { date });
      expect(conflictReasons(away.body)).toEqual(['TIME_OFF']);

      const wed = iso(nextWeekday(WED));
      await ok(
        s.admin.post('/settings/closures', {
          title: 'Victory Day',
          startDate: wed,
          endDate: wed,
        }),
        201,
      );
      const closed = await book(s, { date: wed });
      expect(conflictReasons(closed.body)).toEqual(['CENTER_CLOSED']);
      expect(closed.body.conflicts[0].message).toBe('The center is closed');
    });

    it('detects clashes with the therapist’s and the patient’s other appointments', async () => {
      const s = await setup();
      const first = await ok<Detail>(book(s, { durationMinutes: 60 }), 201);

      const sibling = await createPatient(
        s.admin,
        'Ayesha Rahman',
        '01711-222444',
      );
      const busy = await book(s, { patientId: sibling.id, startTime: '10:30' });
      expect(busy.status).toBe(409);
      expect(busy.body).toMatchObject({
        code: 'APPOINTMENT_CONFLICT',
        overridable: false,
      });
      expect(busy.body.conflicts).toMatchObject([
        {
          reason: 'THERAPIST_BUSY',
          appointmentId: first.id,
          message: expect.stringContaining('10:00 AM–11:00 AM'),
        },
      ]);

      const other = await createTherapist(s.admin, [s.t.OT], {
        fullName: 'Therapist B',
        mobile: '01711-000222',
      });
      const patientBusy = await book(s, {
        therapistId: other.id,
        startTime: '10:30',
      });
      expect(conflictReasons(patientBusy.body)).toEqual(['PATIENT_BUSY']);

      // Touching is fine: 11:00 starts as the first one ends.
      await ok(book(s, { patientId: sibling.id, startTime: '11:00' }), 201);
    });

    it('keeps the booking buffer free after each appointment', async () => {
      const s = await setup();
      await ok(
        s.admin.patch('/settings/scheduling', { bookingBufferMinutes: 15 }),
      );
      await ok(book(s, { durationMinutes: 60 }), 201);
      const sibling = await createPatient(
        s.admin,
        'Ayesha Rahman',
        '01711-222444',
      );
      const tight = await book(s, {
        patientId: sibling.id,
        startTime: '11:00',
      });
      expect(conflictReasons(tight.body)).toEqual(['THERAPIST_BUSY']);
      await ok(book(s, { patientId: sibling.id, startTime: '11:30' }), 201);
    });

    it('books over a clash only when the center allows double booking and staff ask for it', async () => {
      const s = await setup();
      await ok(book(s), 201);
      const sibling = await createPatient(
        s.admin,
        'Ayesha Rahman',
        '01711-222444',
      );
      const refused = await book(s, {
        patientId: sibling.id,
        allowOverlap: true,
      });
      expect(refused.status).toBe(409);
      expect(refused.body.overridable).toBe(false);

      await ok(
        s.admin.patch('/settings/scheduling', { allowDoubleBooking: true }),
      );
      const asked = await book(s, { patientId: sibling.id });
      expect(asked.status).toBe(409);
      expect(asked.body.overridable).toBe(true);
      const forced = await ok<Detail>(
        book(s, { patientId: sibling.id, allowOverlap: true }),
        201,
      );
      expect(forced.allowOverlap).toBe(true);

      // Double booking never overrides other rules.
      const early = await book(s, {
        patientId: sibling.id,
        startTime: '08:00',
        allowOverlap: true,
      });
      expect(early.status).toBe(409);
      expect(early.body.overridable).toBe(false);
    });

    it('applies the minimum notice, the advance limit and past dates', async () => {
      const s = await setup();
      await ok(
        s.admin.patch('/settings/scheduling', {
          minimumBookingNoticeMinutes: 43_200,
        }),
      );
      const soon = await book(s);
      expect(conflictReasons(soon.body)).toEqual(['TOO_SOON']);
      await ok(
        s.admin.patch('/settings/scheduling', {
          minimumBookingNoticeMinutes: 0,
        }),
      );

      const far = await book(s, { date: iso(nextWeekday(MON, 70)) });
      expect(conflictReasons(far.body)).toEqual(['TOO_FAR_AHEAD']);

      const past = iso(recentWorkday());
      const before = await book(s, { date: past });
      expect(conflictReasons(before.body)).toEqual(['IN_THE_PAST']);
      await ok(
        s.admin.patch('/settings/scheduling', { allowPastDateBooking: true }),
      );
      await ok(book(s, { date: past }), 201);
    });
  });

  // ── Available slots ───────────────────────────────────────────────────────

  describe('available slots', () => {
    it('computes slots from schedules and existing appointments', async () => {
      const s = await setup();
      const date = iso(nextWeekday(MON));
      await ok(book(s, { date, durationMinutes: 60 }), 201);
      const res = await ok<{
        slots: { startTime: string; endTime: string; startAt: string }[];
        unavailable: null;
        slotIntervalMinutes: number;
      }>(
        s.admin.get(
          `/appointments/available-slots?therapistId=${s.therapist.id}&therapyTypeId=${s.t.OT}&date=${date}&durationMinutes=60`,
        ),
      );
      // The worked example from the brief.
      expect(res.slots.map((x) => x.startTime)).toEqual([
        '09:00',
        '11:00',
        '11:30',
        '12:00',
        '14:00',
        '14:30',
        '15:00',
        '15:30',
        '16:00',
      ]);
      expect(res.slots[0]).toMatchObject({
        endTime: '10:00',
        startAt: `${date}T03:00:00.000Z`,
      });
      expect(res.unavailable).toBeNull();
    });

    it('treats the appointment being moved as free and explains empty days', async () => {
      const s = await setup();
      const date = iso(nextWeekday(MON));
      const appt = await ok<Detail>(
        book(s, { date, durationMinutes: 60 }),
        201,
      );
      const q = `therapistId=${s.therapist.id}&therapyTypeId=${s.t.OT}&durationMinutes=60`;
      const moving = await ok<{ slots: { startTime: string }[] }>(
        s.admin.get(
          `/appointments/available-slots?${q}&date=${date}&excludeAppointmentId=${appt.id}`,
        ),
      );
      expect(moving.slots.map((x) => x.startTime)).toContain('10:00');

      const friday = await ok<{
        slots: unknown[];
        unavailable: { reason: string; message: string };
      }>(
        s.admin.get(
          `/appointments/available-slots?${q}&date=${iso(nextWeekday(FRI))}`,
        ),
      );
      expect(friday.slots).toEqual([]);
      expect(friday.unavailable.reason).toBe('CENTER_CLOSED');
    });
  });

  // ── Concurrency ───────────────────────────────────────────────────────────

  describe('concurrency', () => {
    it('lets only one of several simultaneous bookings of the same slot succeed', async () => {
      const s = await setup();
      const patients = await Promise.all(
        [1, 2, 3, 4, 5].map((n) =>
          createPatient(s.admin, `Child ${n}`, `01711-22200${n}`),
        ),
      );
      const results = await Promise.all(
        patients.map((p) => book(s, { patientId: p.id })),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(['APPOINTMENT_CONFLICT', 'SLOT_TAKEN']).toContain(r.body.code);
      }
      expect(await prisma.appointment.count()).toBe(1);
    });

    it('is protected by the database even if the application checks are bypassed', async () => {
      const s = await setup();
      const appt = await ok<Detail>(book(s), 201);
      const row = await prisma.appointment.findUniqueOrThrow({
        where: { id: appt.id },
      });
      const { id: _id, createdAt: _c, updatedAt: _u, ...copy } = row;
      void _id;
      void _c;
      void _u;
      await expect(
        prisma.appointment.create({
          data: {
            ...copy,
            startAt: new Date(row.startAt.getTime() + 15 * 60_000),
            endAt: new Date(row.endAt.getTime() + 15 * 60_000),
          },
        }),
      ).rejects.toMatchObject({ code: 'P2039' });
      // Cancelled rows release their time; flagged double bookings are exempt.
      await prisma.appointment.create({
        data: { ...copy, allowOverlap: true },
      });
      await ok(
        s.admin.patch(`/appointments/${appt.id}/cancel`, {
          reason: 'PATIENT_REQUEST',
        }),
      );
      await prisma.appointment.create({ data: copy });
    });

    it('keeps simultaneous recurring bookings from overlapping', async () => {
      const s = await setup();
      const sibling = await createPatient(
        s.admin,
        'Ayesha Rahman',
        '01711-222444',
      );
      const rule = {
        daysOfWeek: [MON, WED],
        startDate: iso(nextWeekday(SAT)),
        endType: 'COUNT',
        count: 4,
      };
      const [a, b] = await Promise.all([
        s.admin.post('/appointment-series', series(s, rule)),
        s.admin.post(
          '/appointment-series',
          series(s, rule, { patientId: sibling.id }),
        ),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await prisma.appointment.count()).toBe(4);
    });

    it('does not let rescheduling create an overlap', async () => {
      const s = await setup();
      const sibling = await createPatient(
        s.admin,
        'Ayesha Rahman',
        '01711-222444',
      );
      const a = await ok<Detail>(book(s, { durationMinutes: 60 }), 201);
      const b = await ok<Detail>(
        book(s, { patientId: sibling.id, startTime: '12:00' }),
        201,
      );
      const clash = await s.admin.patch(`/appointments/${b.id}/reschedule`, {
        date: a.date,
        startTime: '10:30',
      });
      expect(clash.status).toBe(409);
      expect(conflictReasons(clash.body)).toEqual(['THERAPIST_BUSY']);
      // Moving onto part of its own old time is fine.
      const self = await ok<Detail>(
        s.admin.patch(`/appointments/${a.id}/reschedule`, {
          date: a.date,
          startTime: '10:30',
        }),
      );
      expect(self).toMatchObject({ startTime: '10:30', endTime: '11:30' });
    });
  });

  // ── Recurring ─────────────────────────────────────────────────────────────

  describe('recurring', () => {
    const preview = async (s: Setup, body: object) =>
      ok<{
        summary: { total: number; available: number; conflicts: number };
        occurrences: Occurrence[];
      }>(s.admin.post('/appointment-series/preview', body));

    it('repeats on selected weekdays until an end date', async () => {
      const s = await setup();
      const start = nextWeekday(SAT);
      const res = await preview(
        s,
        series(s, {
          daysOfWeek: [SAT, MON, WED],
          startDate: iso(start),
          endType: 'UNTIL',
          until: iso(addDays(start, 11)),
        }),
      );
      expect(res.occurrences.map((o) => o.date)).toEqual(
        [0, 2, 4, 7, 9, 11].map((d) => iso(addDays(start, d))),
      );
      expect(res.summary).toEqual({ total: 6, available: 6, conflicts: 0 });
      expect(res.occurrences.every((o) => o.startTime === '10:00')).toBe(true);
    });

    it('repeats every N weeks', async () => {
      const s = await setup();
      const start = nextWeekday(SAT);
      const res = await preview(
        s,
        series(s, {
          daysOfWeek: [SAT, MON],
          interval: 2,
          startDate: iso(start),
          endType: 'COUNT',
          count: 4,
        }),
      );
      expect(res.occurrences.map((o) => o.date)).toEqual(
        [0, 2, 14, 16].map((d) => iso(addDays(start, d))),
      );
    });

    it('moves monthly dates the month lacks to its last day', async () => {
      const s = await setup();
      await ok(
        s.admin.patch('/settings/scheduling', { advanceBookingLimitDays: 730 }),
      );
      // The next 31st followed by a 30-day month.
      let start = addDays(today(), 7);
      while (!(
        start.getUTCDate() === 31 && addDays(start, 31).getUTCDate() === 1
      )) {
        start = addDays(start, 1);
      }
      const res = await preview(
        s,
        series(s, {
          frequency: 'MONTHLY',
          startDate: iso(start),
          endType: 'COUNT',
          count: 3,
        }),
      );
      expect(res.occurrences.map((o) => [o.date.slice(8), o.adjusted])).toEqual(
        [
          ['31', false],
          ['30', true],
          [expect.stringMatching(/^(31|30|28|29)$/), expect.any(Boolean)],
        ],
      );
    });

    it('limits how many sessions one series can book', async () => {
      const s = await setup();
      const start = iso(nextWeekday(SAT));
      const tooMany = await s.admin.post(
        '/appointment-series/preview',
        series(s, {
          frequency: 'DAILY',
          startDate: start,
          endType: 'UNTIL',
          until: iso(addDays(parseIsoDate(start)!, 200)),
        }),
      );
      expect(tooMany.status).toBe(400);
      expect(tooMany.body.code).toBe('TOO_MANY_OCCURRENCES');
      const count = await s.admin.post(
        '/appointment-series/preview',
        series(s, {
          daysOfWeek: [MON],
          startDate: start,
          endType: 'COUNT',
          count: 101,
        }),
      );
      expect(count.status).toBe(400);
      expect(count.body.errors['recurrence.count']).toBeDefined();
      const tooLong = await s.admin.post(
        '/appointment-series/preview',
        series(s, {
          daysOfWeek: [MON],
          startDate: start,
          endType: 'UNTIL',
          until: iso(addDays(parseIsoDate(start)!, 400)),
        }),
      );
      expect(tooLong.body.errors['recurrence.until']).toBeDefined();
    });

    /** A Mon/Wed series of 4 with a booked clash on the 1st Monday and time off on the 2nd Wednesday. */
    async function conflicted(s: Setup) {
      const start = nextWeekday(SAT);
      const mon1 = addDays(start, 2);
      const wed2 = addDays(start, 11);
      const sibling = await createPatient(
        s.admin,
        'Ayesha Rahman',
        '01711-222444',
      );
      await ok(
        book(s, { patientId: sibling.id, date: iso(mon1), startTime: '10:15' }),
        201,
      );
      await ok(
        s.admin.post(`/therapists/${s.therapist.id}/time-off`, {
          startDate: iso(wed2),
          endDate: iso(wed2),
        }),
        201,
      );
      return {
        body: series(s, {
          daysOfWeek: [MON, WED],
          startDate: iso(start),
          endType: 'COUNT',
          count: 4,
        }),
        mon1: iso(mon1),
        wed2: iso(wed2),
      };
    }

    it('previews conflicts with dates and reasons', async () => {
      const s = await setup();
      const c = await conflicted(s);
      const res = await preview(s, c.body);
      expect(res.summary).toEqual({ total: 4, available: 2, conflicts: 2 });
      const blocked = res.occurrences.filter((o) => !o.available);
      expect(
        blocked.map((o) => [o.date, o.conflicts.map((x) => x.reason)]),
      ).toEqual([
        [c.mon1, ['THERAPIST_BUSY']],
        [c.wed2, ['TIME_OFF']],
      ]);
      expect(blocked[1].conflicts[0].message).toBe(
        'Therapist A is on time off',
      );
    });

    it('books all or nothing by default', async () => {
      const s = await setup();
      const c = await conflicted(s);
      const res = await s.admin.post('/appointment-series', c.body);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'SERIES_CONFLICTS',
        summary: { total: 4, conflicts: 2 },
      });
      expect(await prisma.appointmentSeries.count()).toBe(0);
      expect(await prisma.appointment.count()).toBe(1);
    });

    it('books only the free dates when asked, recording the skipped ones', async () => {
      const s = await setup();
      const c = await conflicted(s);
      const res = await ok<{
        created: number;
        skipped: { date: string }[];
        series: {
          id: string;
          skippedOccurrences: { date: string; reasons: string[] }[];
          appointments: Item[];
          counts: { total: number };
        };
      }>(
        s.admin.post('/appointment-series', { ...c.body, skipConflicts: true }),
        201,
      );
      expect(res.created).toBe(2);
      expect(res.skipped.map((x) => x.date)).toEqual([c.mon1, c.wed2]);
      expect(res.series.skippedOccurrences).toEqual([
        { date: c.mon1, startTime: '10:00', reasons: ['THERAPIST_BUSY'] },
        { date: c.wed2, startTime: '10:00', reasons: ['TIME_OFF'] },
      ]);
      expect(
        res.series.appointments.every((a) => a.seriesId === res.series.id),
      ).toBe(true);
    });

    it('moves and cancels single occurrences without touching the rest', async () => {
      const s = await setup();
      const start = nextWeekday(SAT);
      const created = await ok<{
        series: { id: string; appointments: Item[] };
      }>(
        s.admin.post(
          '/appointment-series',
          series(s, {
            daysOfWeek: [MON, WED],
            startDate: iso(start),
            endType: 'COUNT',
            count: 4,
          }),
        ),
        201,
      );
      const [first, second, third, fourth] = created.series.appointments;

      const moved = await ok<Detail>(
        s.admin.patch(`/appointments/${second.id}/reschedule`, {
          date: second.date,
          startTime: '15:00',
          reason: 'School exam',
        }),
      );
      expect(moved).toMatchObject({
        seriesId: created.series.id,
        startTime: '15:00',
        series: { position: { index: 2, total: 4 } },
      });
      await ok(
        s.admin.patch(`/appointments/${first.id}/cancel`, {
          reason: 'PATIENT_REQUEST',
        }),
      );

      const after = await ok<{ appointments: Item[]; status: string }>(
        s.admin.get(`/appointment-series/${created.series.id}`),
      );
      expect(
        after.appointments.map((a) => [a.id, a.status, a.startTime]),
      ).toEqual([
        [first.id, 'CANCELLED', '10:00'],
        [second.id, 'SCHEDULED', '15:00'],
        [third.id, 'SCHEDULED', '10:00'],
        [fourth.id, 'SCHEDULED', '10:00'],
      ]);

      // "This and following": cancels from the third on, keeps the rest.
      const cut = await ok<{
        cancelled: number;
        series: { status: string; appointments: Item[] };
      }>(
        s.admin.post(`/appointment-series/${created.series.id}/cancel-future`, {
          fromAppointmentId: third.id,
          reason: 'THERAPIST_UNAVAILABLE',
        }),
      );
      expect(cut.cancelled).toBe(2);
      expect(cut.series.appointments.map((a) => a.status)).toEqual([
        'CANCELLED',
        'SCHEDULED',
        'CANCELLED',
        'CANCELLED',
      ]);
      expect(cut.series.status).toBe('ACTIVE');
    });

    it('never cancels completed occurrences with the rest of a series', async () => {
      const s = await setup();
      await ok(
        s.admin.patch('/settings/scheduling', { allowPastDateBooking: true }),
      );
      const past = recentWorkday(3);
      const created = await ok<{
        series: { id: string; appointments: Item[] };
      }>(
        s.admin.post(
          '/appointment-series',
          series(s, {
            frequency: 'DAILY',
            interval: 7,
            startDate: iso(past),
            endType: 'COUNT',
            count: 3,
          }),
        ),
        201,
      );
      const [done] = created.series.appointments;
      await ok(
        s.admin.patch(`/appointments/${done.id}/status`, {
          status: 'COMPLETED',
        }),
      );
      const cut = await ok<{
        cancelled: number;
        series: { status: string; appointments: Item[] };
      }>(
        s.admin.post(`/appointment-series/${created.series.id}/cancel-future`, {
          fromAppointmentId: done.id,
          reason: 'PATIENT_REQUEST',
        }),
      );
      expect(cut.cancelled).toBe(2);
      expect(cut.series.appointments.map((a) => a.status)).toEqual([
        'COMPLETED',
        'CANCELLED',
        'CANCELLED',
      ]);
      expect(cut.series.status).toBe('CANCELLED');
    });
  });

  // ── Status, cancellation and history ──────────────────────────────────────

  describe('status and cancellation', () => {
    it('follows the allowed status transitions', async () => {
      const s = await setup();
      const future = await ok<Detail>(book(s), 201);
      const confirmed = await ok<Detail>(
        s.admin.patch(`/appointments/${future.id}/status`, {
          status: 'CONFIRMED',
        }),
      );
      expect(confirmed.status).toBe('CONFIRMED');
      const early = await s.admin.patch(`/appointments/${future.id}/status`, {
        status: 'COMPLETED',
      });
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('APPOINTMENT_NOT_STARTED');
      const viaStatus = await s.admin.patch(
        `/appointments/${future.id}/status`,
        { status: 'CANCELLED' },
      );
      expect(viaStatus.status).toBe(400);

      await ok(
        s.admin.patch('/settings/scheduling', { allowPastDateBooking: true }),
      );
      const past = await ok<Detail>(
        book(s, { date: iso(recentWorkday()) }),
        201,
      );
      expect(past.actions).toMatchObject({ complete: true, noShow: true });
      const done = await ok<Detail>(
        s.admin.patch(`/appointments/${past.id}/status`, {
          status: 'COMPLETED',
        }),
      );
      expect(done.status).toBe('COMPLETED');
      for (const status of ['CONFIRMED', 'NO_SHOW']) {
        const res = await s.admin.patch(`/appointments/${past.id}/status`, {
          status,
        });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
      }
      const reschedule = await s.admin.patch(
        `/appointments/${past.id}/reschedule`,
        { date: future.date, startTime: '15:00' },
      );
      expect(reschedule.body.code).toBe('INVALID_STATUS_TRANSITION');

      await ok(
        s.admin.patch(`/appointments/${future.id}/cancel`, { reason: 'OTHER' }),
      );
      const revive = await s.admin.patch(`/appointments/${future.id}/status`, {
        status: 'CONFIRMED',
      });
      expect(revive.body.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('applies the cancellation cutoff, with an override for managers', async () => {
      const s = await setup();
      const desk = await addStaff(app, s.admin, mail, {
        email: 'desk@example.com',
        role: 'RECEPTIONIST',
      });
      await ok(
        s.admin.patch('/settings/scheduling', {
          cancellationCutoffMinutes: 43_200,
        }),
      );
      const appt = await ok<Detail>(book(s), 201);
      const asDesk = await ok<Detail>(
        desk.browser.get(`/appointments/${appt.id}`),
      );
      expect(asDesk.actions).toMatchObject({
        cancel: false,
        lateCancellation: true,
      });

      const refused = await desk.browser.patch(
        `/appointments/${appt.id}/cancel`,
        { reason: 'PATIENT_REQUEST' },
      );
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('LATE_CANCELLATION_NOT_ALLOWED');

      const cancelled = await ok<Detail>(
        s.admin.patch(`/appointments/${appt.id}/cancel`, {
          reason: 'PATIENT_REQUEST',
          note: 'Family emergency',
        }),
      );
      expect(cancelled).toMatchObject({
        status: 'CANCELLED',
        lateCancellation: true,
        cancellationReason: 'PATIENT_REQUEST',
      });
      // Cancelling releases the slot.
      const sibling = await createPatient(
        s.admin,
        'Ayesha Rahman',
        '01711-222444',
      );
      await ok(book(s, { patientId: sibling.id }), 201);
    });

    it('keeps the full history of an appointment', async () => {
      const s = await setup();
      const appt = await ok<Detail>(book(s), 201);
      const other = await createTherapist(s.admin, [s.t.OT], {
        fullName: 'Therapist B',
        mobile: '01711-000222',
      });
      await ok(
        s.admin.patch(`/appointments/${appt.id}/reschedule`, {
          date: appt.date,
          startTime: '14:00',
          therapistId: other.id,
          durationMinutes: 60,
          reason: 'Guardian asked for the afternoon',
        }),
      );
      await ok(
        s.admin.patch(`/appointments/${appt.id}`, {
          internalNotes: 'Bring the sensory kit',
        }),
      );
      await ok(
        s.admin.patch(`/appointments/${appt.id}/cancel`, {
          reason: 'THERAPIST_UNAVAILABLE',
        }),
      );
      const detail = await ok<Detail>(s.admin.get(`/appointments/${appt.id}`));
      expect(detail.history.map((h) => h.action)).toEqual([
        'CREATED',
        'RESCHEDULED',
        'UPDATED',
        'CANCELLED',
      ]);
      expect(detail.history[1]).toMatchObject({
        reason: 'Guardian asked for the afternoon',
        previousValues: {
          startTime: '10:00',
          therapist: { fullName: 'Therapist A' },
          durationMinutes: 45,
        },
        newValues: {
          startTime: '14:00',
          therapist: { fullName: 'Therapist B' },
          durationMinutes: 60,
        },
        performedBy: { fullName: 'Kamrul Islam' },
      });
      // Note text stays out of history.
      expect(detail.history[2].newValues).toEqual({
        fields: ['internalNotes'],
      });
      const cancelled = await ok<{ items: Item[] }>(
        s.admin.get('/appointments?status=CANCELLED'),
      );
      expect(cancelled.items.map((i) => i.id)).toEqual([appt.id]);
    });
  });

  // ── Security ──────────────────────────────────────────────────────────────

  describe('security', () => {
    it('isolates centers', async () => {
      const s = await setup();
      const appt = await ok<Detail>(book(s), 201);
      const other = await setup();

      expect((await other.admin.get(`/appointments/${appt.id}`)).status).toBe(
        404,
      );
      expect(
        (
          await other.admin.patch(`/appointments/${appt.id}/cancel`, {
            reason: 'OTHER',
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await other.admin.patch(`/appointments/${appt.id}/reschedule`, {
            date: appt.date,
            startTime: '11:00',
          })
        ).status,
      ).toBe(404);
      expect(
        (await ok<{ total: number }>(other.admin.get('/appointments'))).total,
      ).toBe(0);

      // Another center's patient, therapist or therapy can't be booked.
      expect((await book(other, { patientId: s.patient.id })).body.code).toBe(
        'PATIENT_NOT_FOUND',
      );
      expect(
        (await book(other, { therapistId: s.therapist.id })).body.code,
      ).toBe('THERAPIST_NOT_FOUND');
      expect((await book(other, { therapyTypeId: s.t.OT })).body.code).toBe(
        'THERAPY_TYPE_NOT_FOUND',
      );
      const slots = await other.admin.get(
        `/appointments/available-slots?therapistId=${s.therapist.id}&therapyTypeId=${other.t.OT}&date=${appt.date}&durationMinutes=45`,
      );
      expect(slots.status).toBe(404);
    });

    it('limits therapists to their own appointments and front-desk work to front-desk roles', async () => {
      const s = await setup();
      const staff = await addStaff(app, s.admin, mail, {
        email: 'ot@example.com',
        role: 'THERAPIST',
      });
      const mine = await createTherapist(s.admin, [s.t.OT], {
        fullName: 'Therapist B',
        mobile: '01711-000222',
        membershipId: staff.membershipId,
      });
      const theirs = await ok<Detail>(book(s), 201);
      const own = await ok<Detail>(
        book(s, { therapistId: mine.id, startTime: '14:00' }),
        201,
      );

      const list = await ok<{ items: Item[] }>(
        staff.browser.get('/appointments'),
      );
      expect(list.items.map((i) => i.id)).toEqual([own.id]);
      expect(list.items[0].therapist.isYou).toBe(true);
      expect(
        (await staff.browser.get(`/appointments/${theirs.id}`)).status,
      ).toBe(404);
      const detail = await ok<Detail>(
        staff.browser.get(`/appointments/${own.id}`),
      );
      expect(detail.primaryContact).toBeNull();
      expect(detail.actions).toMatchObject({
        confirm: true,
        cancel: false,
        reschedule: false,
      });

      await ok(
        staff.browser.patch(`/appointments/${own.id}/status`, {
          status: 'CONFIRMED',
        }),
      );
      expect(
        (await book(s, { startTime: '15:00' }, staff.browser)).status,
      ).toBe(403);
      expect(
        (
          await staff.browser.patch(`/appointments/${own.id}/cancel`, {
            reason: 'OTHER',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await staff.browser.patch(`/appointments/${own.id}/reschedule`, {
            date: own.date,
            startTime: '15:00',
          })
        ).status,
      ).toBe(403);
      expect(
        (await staff.browser.post('/appointment-series/preview', series(s, {})))
          .status,
      ).toBe(403);

      const desk = await addStaff(app, s.admin, mail, {
        email: 'desk@example.com',
        role: 'RECEPTIONIST',
      });
      await ok(book(s, { startTime: '15:00' }, desk.browser), 201);
      await ok(
        desk.browser.patch(`/appointments/${own.id}/reschedule`, {
          date: own.date,
          startTime: '15:45',
        }),
      );
    });
  });

  // ── Time zones ────────────────────────────────────────────────────────────

  describe('time zones', () => {
    it('keeps instants when the center changes time zone', async () => {
      const s = await setup();
      const appt = await ok<Detail>(book(s), 201);
      await ok(s.admin.patch('/centers/current', { timezone: 'Asia/Karachi' }));
      const after = await ok<Detail>(s.admin.get(`/appointments/${appt.id}`));
      expect(after.startAt).toBe(appt.startAt);
      // UTC+5 instead of UTC+6: the same instant, shown on the new wall clock.
      expect(after.startTime).toBe('09:00');
    });

    it('keeps recurring wall-clock times across a daylight-saving change', async () => {
      const s = await setup();
      await ok(
        s.admin.patch('/centers/current', { timezone: 'America/New_York' }),
      );
      await ok(
        s.admin.patch('/settings/scheduling', {
          allowPastDateBooking: true,
          advanceBookingLimitDays: 730,
        }),
      );
      // New York leaves daylight saving on 1 November 2026.
      const res = await preview(
        s,
        series(s, {
          daysOfWeek: [MON],
          startDate: '2026-10-26',
          endType: 'COUNT',
          count: 2,
        }),
      );
      expect(
        res.occurrences.map((o) => [o.date, o.startTime, o.startAt]),
      ).toEqual([
        ['2026-10-26', '10:00', '2026-10-26T14:00:00.000Z'],
        ['2026-11-02', '10:00', '2026-11-02T15:00:00.000Z'],
      ]);

      // 02:30 doesn't exist on 14 March 2027, when clocks jump from 02:00 to 03:00.
      const gap = await book(s, { date: '2027-03-14', startTime: '02:30' });
      expect(gap.status).toBe(400);
      expect(gap.body.errors.startTime).toMatch(/clocks change/);
    });

    async function preview(s: Setup, body: object) {
      return ok<{ occurrences: Occurrence[] }>(
        s.admin.post('/appointment-series/preview', body),
      );
    }
  });
});
