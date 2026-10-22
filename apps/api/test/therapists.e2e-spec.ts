import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

import {
  addDays,
  formatIsoDate,
  parseIsoDate,
  todayIn,
} from '../src/common/time';
import { PrismaService } from '../src/prisma/prisma.service';
import { ScheduleService } from '../src/therapists/schedule.service';
import {
  Browser,
  FakeMail,
  addStaff,
  createTestApp,
  registerCenter,
  resetDatabase,
} from './helpers';

interface TherapyType {
  id: string;
  code: string;
}

interface Specialization {
  therapyTypeId: string;
  code: string;
  isPrimary: boolean;
  isActive: boolean;
}

interface Therapist {
  id: string;
  code: string;
  fullName: string;
  mobile: string;
  email: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  employmentType: string | null;
  joiningDate: string | null;
  specializations: Specialization[];
  availabilitySummary: { daysOfWeek: number[]; weeklyMinutes: number };
  hasAccount: boolean;
  isYou: boolean;
  account: { membershipId: string; email: string } | null;
  bookingIssues: string[];
  upcomingAppointments: number | null;
}

interface ScheduleDay {
  date: string;
  dayOfWeek: number;
  centerHours: { start: string; end: string }[];
  closures: { title: string; start: string; end: string }[];
  regularHours: { start: string; end: string }[];
  timeOff: { start: string; end: string }[];
  available: { start: string; end: string }[];
  appointments: { id: string; startAt: string; endAt: string }[];
}

const SAT = 6;
const SUN = 0;
const MON = 1;

/** A week from the editor, with the given days' intervals; other days off. */
function week(byDay: Record<number, [string, string][]>, off: number[] = []) {
  return {
    days: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      isAvailable:
        Boolean(byDay[dayOfWeek]?.length) && !off.includes(dayOfWeek),
      intervals: (byDay[dayOfWeek] ?? []).map(([start, end]) => ({
        start,
        end,
      })),
    })),
  };
}

/** An ISO date `offset` days from today in Dhaka, the test centers' time zone. */
function dayFromToday(offset: number) {
  return formatIsoDate(addDays(todayIn('Asia/Dhaka'), offset));
}

/** The first date on or after `from` days ahead that falls on `dayOfWeek`. */
function nextWeekday(dayOfWeek: number, from = 7) {
  let date = addDays(todayIn('Asia/Dhaka'), from);
  while (date.getUTCDay() !== dayOfWeek) date = addDays(date, 1);
  return formatIsoDate(date);
}

describe('Therapist management (e2e)', () => {
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

  async function types(admin: Browser) {
    const list = (await admin.get('/therapy-types')).body as TherapyType[];
    return Object.fromEntries(list.map((t) => [t.code, t.id])) as Record<
      string,
      string
    >;
  }

  async function createTherapist(admin: Browser, body: object = {}) {
    const res = await admin.post('/therapists', {
      fullName: 'Dr. Rahman',
      mobile: '01711-000111',
      ...body,
    });
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    return res.body as Therapist;
  }

  describe('profiles', () => {
    it('onboards a therapist with specializations and weekly availability', async () => {
      const { browser: admin } = await registerCenter(app);
      const t = await types(admin);
      const res = await admin.post('/therapists', {
        fullName: '  Dr. Rahman ',
        mobile: '+880 1711-000111',
        email: 'Rahman@Example.com',
        gender: 'MALE',
        designation: 'Senior Occupational Therapist',
        qualifications: 'BSc OT, University of Dhaka',
        registrationNumber: 'BOTA-1234',
        yearsOfExperience: 8,
        joiningDate: '2024-01-15',
        employmentType: 'FULL_TIME',
        specializations: {
          therapyTypeIds: [t.OT, t.ABA],
          primaryTherapyTypeId: t.ABA,
        },
        availability: week({
          [SAT]: [
            ['09:00', '13:00'],
            ['15:00', '18:00'],
          ],
          [SUN]: [['10:00', '16:00']],
        }),
      });
      expect(res.status).toBe(201);
      const therapist = res.body as Therapist;
      expect(therapist).toMatchObject({
        code: 'TH-0001',
        fullName: 'Dr. Rahman',
        mobile: '01711000111',
        email: 'rahman@example.com',
        status: 'ACTIVE',
        joiningDate: '2024-01-15',
        employmentType: 'FULL_TIME',
        hasAccount: false,
        account: null,
        bookingIssues: [],
        // Counted from real appointments: none booked yet.
        upcomingAppointments: 0,
      });
      expect(
        therapist.specializations.map((s) => [s.code, s.isPrimary]),
      ).toEqual([
        ['ABA', true],
        ['OT', false],
      ]);
      expect(therapist.availabilitySummary).toEqual({
        daysOfWeek: [SUN, SAT],
        weeklyMinutes: (4 + 3 + 6) * 60,
      });

      // Profile without availability or specializations: allowed, but flagged.
      const minimal = await createTherapist(admin, {
        fullName: 'Visiting SLT',
        mobile: '+44 7700 900123',
      });
      expect(minimal.code).toBe('TH-0002');
      expect(minimal.mobile).toBe('+447700900123');
      expect(minimal.bookingIssues).toEqual([
        'NO_SPECIALIZATION',
        'NO_AVAILABILITY',
      ]);
    });

    it('validates the profile fields', async () => {
      const { browser: admin } = await registerCenter(app);
      const res = await admin.post('/therapists', {
        fullName: ' ',
        mobile: '12345',
        email: 'not-an-email',
        yearsOfExperience: -1,
        joiningDate: '2026-02-30',
        employmentType: 'FREELANCE',
      });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.errors as object).sort()).toEqual([
        'email',
        'employmentType',
        'fullName',
        'mobile',
        'yearsOfExperience',
      ]);
      expect(res.body.errors.yearsOfExperience).toBe(
        'Experience can’t be negative',
      );

      // The shape is fine, but the date doesn't exist.
      const badDate = await admin.post('/therapists', {
        fullName: 'A',
        mobile: '01711000111',
        joiningDate: '2026-02-30',
      });
      expect(badDate.status).toBe(400);
      expect(badDate.body.errors).toEqual({
        joiningDate: 'Choose a valid joining date',
      });

      // A therapist ID can't be chosen or changed.
      expect(
        (
          await admin.post('/therapists', {
            fullName: 'A',
            mobile: '01711000111',
            code: 'X',
          })
        ).status,
      ).toBe(400);
    });

    it('edits a profile and clears optional fields', async () => {
      const { browser: admin } = await registerCenter(app);
      const created = await createTherapist(admin, {
        email: 'a@example.com',
        employmentType: 'PART_TIME',
        joiningDate: '2025-03-01',
      });
      const res = await admin.patch(`/therapists/${created.id}`, {
        fullName: 'Dr. A. Rahman',
        mobile: '01811-222333',
        email: '',
        employmentType: 'VISITING',
        joiningDate: null,
        notes: 'Prefers morning sessions',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        code: created.code,
        fullName: 'Dr. A. Rahman',
        mobile: '01811222333',
        email: null,
        employmentType: 'VISITING',
        joiningDate: null,
        notes: 'Prefers morning sessions',
      });
      expect(
        (await admin.patch(`/therapists/${created.id}`, { fullName: '' }))
          .status,
      ).toBe(400);
      expect(
        (await admin.patch(`/therapists/${created.id}`, { mobile: ' ' }))
          .status,
      ).toBe(400);
      expect(
        (await admin.patch(`/therapists/${created.id}`, { code: 'TH-9999' }))
          .status,
      ).toBe(400);
      const audit = await prisma.auditLog.findMany({
        where: { entityId: created.id, action: 'therapist.updated' },
      });
      expect(audit).toHaveLength(1);
      // Free text isn't copied into the audit log.
      expect(JSON.stringify(audit[0].metadata)).not.toContain('morning');
    });

    it('numbers therapist IDs per center and never reuses them', async () => {
      const a = await registerCenter(app);
      const b = await registerCenter(app);
      const a1 = await createTherapist(a.browser);
      const a2 = await createTherapist(a.browser, { fullName: 'Second' });
      const b1 = await createTherapist(b.browser);
      expect([a1.code, a2.code, b1.code]).toEqual([
        'TH-0001',
        'TH-0002',
        'TH-0001',
      ]);

      expect((await a.browser.delete(`/therapists/${a2.id}`)).status).toBe(204);
      const a3 = await createTherapist(a.browser, { fullName: 'Third' });
      expect(a3.code).toBe('TH-0003');
    });

    it('lists with search, filters, sorting and pagination', async () => {
      const { browser: admin } = await registerCenter(app);
      const t = await types(admin);
      await createTherapist(admin, {
        fullName: 'Nusrat Jahan',
        mobile: '01911-555666',
        email: 'nusrat@example.com',
        employmentType: 'FULL_TIME',
        joiningDate: '2023-05-01',
        specializations: { therapyTypeIds: [t.SLT] },
      });
      const farhan = await createTherapist(admin, {
        fullName: 'Farhan Ahmed',
        employmentType: 'VISITING',
        joiningDate: '2025-08-01',
        specializations: { therapyTypeIds: [t.OT, t.SLT] },
      });
      await createTherapist(admin, {
        fullName: 'Ayesha Siddiqua',
        status: 'INACTIVE',
      });

      const names = async (query: string) =>
        (
          (await admin.get(`/therapists?${query}`)).body.items as Therapist[]
        ).map((x) => x.fullName);
      expect(await names('')).toEqual([
        'Ayesha Siddiqua',
        'Farhan Ahmed',
        'Nusrat Jahan',
      ]);
      expect(await names('search=nusrat@')).toEqual(['Nusrat Jahan']);
      expect(await names('search=%2B880%201911')).toEqual(['Nusrat Jahan']);
      expect(await names(`search=${farhan.code}`)).toEqual(['Farhan Ahmed']);
      expect(await names(`therapyTypeId=${t.SLT}`)).toEqual([
        'Farhan Ahmed',
        'Nusrat Jahan',
      ]);
      expect(await names('employmentType=VISITING')).toEqual(['Farhan Ahmed']);
      expect(await names('status=INACTIVE')).toEqual(['Ayesha Siddiqua']);
      expect(await names('joinedFrom=2024-01-01&joinedTo=2025-12-31')).toEqual([
        'Farhan Ahmed',
      ]);
      expect(await names('sortBy=joiningDate&sortOrder=desc')).toEqual([
        'Farhan Ahmed',
        'Nusrat Jahan',
        'Ayesha Siddiqua',
      ]);

      const page = await admin.get('/therapists?page=2&pageSize=2');
      expect(page.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect((page.body.items as Therapist[]).map((x) => x.fullName)).toEqual([
        'Nusrat Jahan',
      ]);
      expect((await admin.get('/therapists?sortBy=password')).status).toBe(400);
    });
  });

  describe('specializations', () => {
    it('adds, removes and re-primaries specializations, keeping one primary', async () => {
      const { browser: admin } = await registerCenter(app);
      const t = await types(admin);
      const therapist = await createTherapist(admin, {
        specializations: { therapyTypeIds: [t.OT] },
      });
      expect(therapist.specializations).toMatchObject([
        { code: 'OT', isPrimary: true },
      ]);

      const path = `/therapists/${therapist.id}/specializations`;
      const both = await admin.put(path, {
        therapyTypeIds: [t.OT, t.ABA],
        primaryTherapyTypeId: t.ABA,
      });
      expect(both.status).toBe(200);
      expect(
        (both.body as Specialization[]).map((s) => [s.code, s.isPrimary]),
      ).toEqual([
        ['ABA', true],
        ['OT', false],
      ]);
      const otRow = await prisma.therapistSpecialization.findFirstOrThrow({
        where: { therapistId: therapist.id, therapyTypeId: t.OT },
      });

      // Removing the primary passes it on; kept rows keep their identity.
      const swapped = await admin.put(path, { therapyTypeIds: [t.OT, t.SLT] });
      expect(
        (swapped.body as Specialization[]).map((s) => [s.code, s.isPrimary]),
      ).toEqual([
        ['OT', true],
        ['SLT', false],
      ]);
      const otAfter = await prisma.therapistSpecialization.findFirstOrThrow({
        where: { therapistId: therapist.id, therapyTypeId: t.OT },
      });
      expect(otAfter.id).toBe(otRow.id);
      expect(
        await prisma.therapistSpecialization.count({
          where: { therapistId: therapist.id, isPrimary: true },
        }),
      ).toBe(1);
      expect((await admin.get(path)).body).toHaveLength(2);
    });

    it('rejects duplicates, inactive types and other centers’ types', async () => {
      const { browser: admin } = await registerCenter(app);
      const other = await registerCenter(app);
      const t = await types(admin);
      const foreign = await types(other.browser);
      const therapist = await createTherapist(admin);
      const path = `/therapists/${therapist.id}/specializations`;

      const dup = await admin.put(path, { therapyTypeIds: [t.OT, t.OT] });
      expect(dup.status).toBe(400);
      expect(dup.body.errors.therapyTypeIds).toBe(
        'Each therapy type can only be added once',
      );

      const cross = await admin.put(path, {
        therapyTypeIds: [t.OT, foreign.ABA],
      });
      expect(cross.status).toBe(400);
      expect(cross.body.code).toBe('THERAPY_TYPE_NOT_FOUND');
      const crossCreate = await admin.post('/therapists', {
        fullName: 'X',
        mobile: '01711000111',
        specializations: { therapyTypeIds: [foreign.OT] },
      });
      expect(crossCreate.status).toBe(400);
      expect(crossCreate.body.errors).toHaveProperty([
        'specializations.therapyTypeIds',
      ]);

      const badPrimary = await admin.put(path, {
        therapyTypeIds: [t.OT],
        primaryTherapyTypeId: t.ABA,
      });
      expect(badPrimary.status).toBe(400);

      // Inactive types can't be newly assigned, but stay where they already are.
      expect((await admin.put(path, { therapyTypeIds: [t.OT] })).status).toBe(
        200,
      );
      await admin.patch(`/therapy-types/${t.ABA}/status`, { isActive: false });
      await admin.patch(`/therapy-types/${t.OT}/status`, { isActive: false });
      const inactive = await admin.put(path, { therapyTypeIds: [t.OT, t.ABA] });
      expect(inactive.status).toBe(400);
      expect(inactive.body.code).toBe('THERAPY_TYPE_INACTIVE');
      const kept = await admin.put(path, { therapyTypeIds: [t.OT, t.SLT] });
      expect(kept.status).toBe(200);
      expect(
        (kept.body as Specialization[]).find((s) => s.code === 'OT')?.isActive,
      ).toBe(false);

      // Assigned therapy types can't be deleted out from under a therapist.
      expect((await admin.delete(`/therapy-types/${t.OT}`)).status).toBe(409);
    });
  });

  describe('weekly availability', () => {
    it('stores several intervals a day and keeps switched-off days’ hours', async () => {
      const { browser: admin } = await registerCenter(app);
      const therapist = await createTherapist(admin);
      const path = `/therapists/${therapist.id}/availability`;

      const res = await admin.put(
        path,
        week(
          {
            [SAT]: [
              ['15:00', '18:00'],
              ['09:00', '13:00'],
            ],
            [MON]: [['09:00', '12:00']],
            // Friday: the center is closed, so this is flagged, not refused.
            5: [['10:00', '12:00']],
          },
          [MON],
        ),
      );
      expect(res.status).toBe(200);
      const sat = res.body.days[SAT];
      expect(sat).toEqual({
        dayOfWeek: SAT,
        isAvailable: true,
        intervals: [
          { start: '09:00', end: '13:00', outsideCenterHours: false },
          { start: '15:00', end: '18:00', outsideCenterHours: false },
        ],
      });
      expect(res.body.days[MON]).toMatchObject({
        isAvailable: false,
        intervals: [{ start: '09:00', end: '12:00' }],
      });
      expect(res.body.days[5].intervals[0].outsideCenterHours).toBe(true);
      expect(res.body.timezone).toBe('Asia/Dhaka');
      expect(res.body.summary).toEqual({
        daysOfWeek: [5, SAT],
        weeklyMinutes: 9 * 60,
      });

      const detail = (await admin.get(`/therapists/${therapist.id}`))
        .body as Therapist;
      expect(detail.availabilitySummary.daysOfWeek).toEqual([5, SAT]);
    });

    it('rejects overlapping and back-to-front intervals', async () => {
      const { browser: admin } = await registerCenter(app);
      const therapist = await createTherapist(admin);
      const path = `/therapists/${therapist.id}/availability`;
      await admin.put(path, week({ [SAT]: [['09:00', '12:00']] }));

      const res = await admin.put(
        path,
        week({
          [SAT]: [
            ['09:00', '13:00'],
            ['12:00', '15:00'],
          ],
          [SUN]: [['14:00', '10:00']],
        }),
      );
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual({
        [`days.${SAT}.intervals.1.start`]: 'Overlaps 09:00–13:00',
        [`days.${SUN}.intervals.0.end`]: 'End time must be after start time',
      });
      // Nothing changed.
      expect((await admin.get(path)).body.days[SAT].intervals).toHaveLength(1);

      const onboarding = await admin.post('/therapists', {
        fullName: 'X',
        mobile: '01711000111',
        availability: week({ [SAT]: [['10:00', '09:00']] }),
      });
      expect(onboarding.status).toBe(400);
      expect(onboarding.body.errors).toHaveProperty([
        `availability.days.${SAT}.intervals.0.end`,
      ]);
      expect(await prisma.therapist.count()).toBe(1);
    });
  });

  describe('time off', () => {
    it('adds, edits, lists and removes time off', async () => {
      const { browser: admin } = await registerCenter(app);
      const therapist = await createTherapist(admin);
      const path = `/therapists/${therapist.id}/time-off`;

      const leave = await admin.post(path, {
        startDate: dayFromToday(10),
        endDate: dayFromToday(12),
        reason: 'VACATION',
        note: 'Family trip',
      });
      expect(leave.status).toBe(201);
      // Checked against real appointments: nothing booked in that period.
      expect(leave.body.conflictingAppointments).toEqual([]);
      expect(leave.body.timeOff).toMatchObject({
        isAllDay: true,
        startDate: dayFromToday(10),
        endDate: dayFromToday(12),
        startTime: null,
        reason: 'VACATION',
        state: 'upcoming',
      });
      // All-day time off runs from midnight to midnight in Dhaka (UTC+6).
      expect(leave.body.timeOff.startAt).toBe(
        new Date(
          parseIsoDate(dayFromToday(10))!.getTime() - 6 * 3_600_000,
        ).toISOString(),
      );

      const partial = await admin.post(path, {
        startDate: dayFromToday(20),
        endDate: dayFromToday(20),
        isAllDay: false,
        startTime: '14:00',
        endTime: '16:30',
        reason: 'TRAINING',
      });
      expect(partial.status).toBe(201);
      expect(partial.body.timeOff).toMatchObject({
        startTime: '14:00',
        endTime: '16:30',
      });

      const edited = await admin.patch(`${path}/${partial.body.timeOff.id}`, {
        endTime: '17:00',
        note: '',
      });
      expect(edited.status).toBe(200);
      expect(edited.body.timeOff).toMatchObject({
        startTime: '14:00',
        endTime: '17:00',
        note: null,
      });

      // Something that already happened shows under past.
      await prisma.therapistTimeOff.create({
        data: {
          centerId: (
            await prisma.therapist.findUniqueOrThrow({
              where: { id: therapist.id },
            })
          ).centerId,
          therapistId: therapist.id,
          startAt: new Date(Date.now() - 3 * 86_400_000),
          endAt: new Date(Date.now() - 2 * 86_400_000),
          isAllDay: true,
          reason: 'SICK',
        },
      });
      const upcoming = (await admin.get(path)).body as { reason: string }[];
      expect(upcoming.map((x) => x.reason)).toEqual(['VACATION', 'TRAINING']);
      const past = (await admin.get(`${path}?period=past`)).body as {
        state: string;
      }[];
      expect(past).toMatchObject([{ state: 'past' }]);

      expect(
        (await admin.delete(`${path}/${leave.body.timeOff.id}`)).status,
      ).toBe(204);
      expect((await admin.get(path)).body).toHaveLength(1);
      expect(
        await prisma.auditLog.count({
          where: { action: { startsWith: 'therapist.time_off' } },
        }),
      ).toBe(4);
    });

    it('rejects invalid and overlapping ranges', async () => {
      const { browser: admin } = await registerCenter(app);
      const therapist = await createTherapist(admin);
      const path = `/therapists/${therapist.id}/time-off`;

      const backwards = await admin.post(path, {
        startDate: dayFromToday(5),
        endDate: dayFromToday(4),
      });
      expect(backwards.status).toBe(400);
      expect(backwards.body.errors.endDate).toBeDefined();

      const sameTime = await admin.post(path, {
        startDate: dayFromToday(5),
        endDate: dayFromToday(5),
        isAllDay: false,
        startTime: '10:00',
        endTime: '10:00',
      });
      expect(sameTime.status).toBe(400);
      expect(sameTime.body.errors.endTime).toBeDefined();

      const noTimes = await admin.post(path, {
        startDate: dayFromToday(5),
        endDate: dayFromToday(5),
        isAllDay: false,
      });
      expect(noTimes.status).toBe(400);
      expect(Object.keys(noTimes.body.errors as object).sort()).toEqual([
        'endTime',
        'startTime',
      ]);

      const tooLong = await admin.post(path, {
        startDate: dayFromToday(1),
        endDate: dayFromToday(400),
      });
      expect(tooLong.status).toBe(400);

      expect(
        (
          await admin.post(path, {
            startDate: dayFromToday(5),
            endDate: dayFromToday(7),
          })
        ).status,
      ).toBe(201);
      const overlap = await admin.post(path, {
        startDate: dayFromToday(7),
        endDate: dayFromToday(7),
        isAllDay: false,
        startTime: '09:00',
        endTime: '10:00',
      });
      expect(overlap.status).toBe(409);
      expect(overlap.body.code).toBe('TIME_OFF_OVERLAP');
      // Back to back is fine.
      expect(
        (
          await admin.post(path, {
            startDate: dayFromToday(8),
            endDate: dayFromToday(8),
          })
        ).status,
      ).toBe(201);
    });
  });

  describe('schedule and availability', () => {
    it('combines regular hours with center hours, closures and time off', async () => {
      const { browser: admin } = await registerCenter(app);
      const t = await types(admin);
      const therapist = await createTherapist(admin, {
        specializations: { therapyTypeIds: [t.OT] },
        availability: week({
          [SAT]: [
            ['08:00', '13:00'],
            ['15:00', '19:00'],
          ],
          [SUN]: [['10:00', '16:00']],
          [MON]: [['09:00', '17:00']],
          5: [['10:00', '12:00']],
        }),
      });
      const saturday = nextWeekday(SAT);
      const sunday = formatIsoDate(addDays(parseIsoDate(saturday)!, 1));
      const monday = formatIsoDate(addDays(parseIsoDate(saturday)!, 2));
      const friday = formatIsoDate(addDays(parseIsoDate(saturday)!, 6));

      await admin.post('/settings/closures', {
        title: 'Victory Day',
        startDate: sunday,
        endDate: sunday,
      });
      await admin.post('/settings/closures', {
        title: 'Staff meeting',
        startDate: monday,
        endDate: monday,
        allDay: false,
        startTime: '15:00',
        endTime: '18:00',
      });
      await admin.post(`/therapists/${therapist.id}/time-off`, {
        startDate: monday,
        endDate: monday,
        isAllDay: false,
        startTime: '09:00',
        endTime: '11:00',
        reason: 'PERSONAL',
      });

      const res = await admin.get(
        `/therapists/${therapist.id}/schedule?startDate=${saturday}&endDate=${friday}`,
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        timezone: 'Asia/Dhaka',
        appointmentsIncluded: true,
      });
      const days = res.body.days as ScheduleDay[];
      expect(days).toHaveLength(7);
      const [sat, sun, mon, , , , fri] = days;
      // Center opens 09:00–18:00.
      expect(sat.available).toEqual([
        { start: '09:00', end: '13:00' },
        { start: '15:00', end: '18:00' },
      ]);
      expect(sun.closures).toMatchObject([
        { title: 'Victory Day', start: '00:00', end: '24:00' },
      ]);
      expect(sun.available).toEqual([]);
      expect(mon.timeOff).toMatchObject([{ start: '09:00', end: '11:00' }]);
      expect(mon.available).toEqual([{ start: '11:00', end: '15:00' }]);
      expect(fri.centerHours).toEqual([]);
      expect(fri.regularHours).toEqual([{ start: '10:00', end: '12:00' }]);
      expect(fri.available).toEqual([]);
      expect(sat.appointments).toEqual([]);

      // The reusable check booking will build on.
      const schedule = app.get(ScheduleService);
      const tenant = {
        centerId: (
          await prisma.therapist.findUniqueOrThrow({
            where: { id: therapist.id },
          })
        ).centerId,
        userId: 'x',
        membershipId: 'x',
        role: 'CENTER_ADMIN' as const,
        permissions: ['therapists.read' as const],
      };
      const at = (date: string, hhmm: string) =>
        new Date(`${date}T${hhmm}:00+06:00`);
      const check = (
        date: string,
        from: string,
        to: string,
        therapyTypeId = t.OT,
      ) =>
        schedule.checkPeriod(tenant, {
          therapistId: therapist.id,
          startAt: at(date, from),
          endAt: at(date, to),
          therapyTypeId,
        });
      expect(await check(saturday, '09:00', '09:45')).toEqual({
        available: true,
        reasons: [],
        appointmentsChecked: false,
      });
      expect((await check(saturday, '08:00', '09:00')).reasons).toEqual([
        'OUTSIDE_CENTER_HOURS',
      ]);
      expect((await check(sunday, '10:00', '11:00')).reasons).toEqual([
        'CENTER_CLOSED',
      ]);
      expect((await check(monday, '10:00', '12:00')).reasons).toEqual([
        'TIME_OFF',
      ]);
      expect((await check(saturday, '09:00', '10:00', t.SLT)).reasons).toEqual([
        'NOT_SPECIALIZED',
      ]);

      // The center's policy can allow booking on closed days.
      await admin.patch('/settings/scheduling', {
        allowBookingOnClosedDays: true,
      });
      expect((await check(friday, '10:00', '11:00')).available).toBe(true);

      // Inactive therapists can't be booked, and their schedule is empty.
      await admin.patch(`/therapists/${therapist.id}/status`, {
        status: 'INACTIVE',
      });
      expect((await check(saturday, '09:00', '10:00')).reasons).toEqual([
        'THERAPIST_INACTIVE',
      ]);
      const inactive = await admin.get(
        `/therapists/${therapist.id}/schedule?startDate=${saturday}&endDate=${saturday}`,
      );
      expect(inactive.body.days[0].available).toEqual([]);

      const tooLong = await admin.get(
        `/therapists/${therapist.id}/schedule?startDate=${saturday}&endDate=${dayFromToday(90)}`,
      );
      expect(tooLong.status).toBe(400);
    });
  });

  describe('status and deletion', () => {
    it('deactivates and reactivates without touching the staff account', async () => {
      const { browser: admin } = await registerCenter(app);
      const staff = await addStaff(app, admin, mail, {
        email: 'rahman@example.com',
        role: 'THERAPIST',
      });
      const therapist = await createTherapist(admin, {
        membershipId: staff.membershipId,
      });

      const off = await admin.patch(`/therapists/${therapist.id}/status`, {
        status: 'INACTIVE',
      });
      expect(off.status).toBe(200);
      expect(off.body).toMatchObject({
        status: 'INACTIVE',
        bookingIssues: ['INACTIVE', 'NO_SPECIALIZATION', 'NO_AVAILABILITY'],
      });
      const membership = await prisma.centerMembership.findUniqueOrThrow({
        where: { id: staff.membershipId },
      });
      expect(membership.status).toBe('ACTIVE');
      expect((await staff.browser.get('/auth/me')).status).toBe(200);

      const on = await admin.patch(`/therapists/${therapist.id}/status`, {
        status: 'ACTIVE',
      });
      expect(on.body.status).toBe('ACTIVE');
      expect(
        await prisma.auditLog.count({
          where: {
            action: { in: ['therapist.deactivated', 'therapist.activated'] },
          },
        }),
      ).toBe(2);
    });

    it('soft-deletes, keeping the record and its history', async () => {
      const { browser: admin } = await registerCenter(app);
      const t = await types(admin);
      const staff = await addStaff(app, admin, mail, {
        email: 'rahman@example.com',
        role: 'THERAPIST',
      });
      const therapist = await createTherapist(admin, {
        membershipId: staff.membershipId,
        specializations: { therapyTypeIds: [t.OT] },
        availability: week({ [SAT]: [['09:00', '12:00']] }),
      });
      await admin.post(`/therapists/${therapist.id}/time-off`, {
        startDate: dayFromToday(3),
        endDate: dayFromToday(3),
      });

      expect((await admin.delete(`/therapists/${therapist.id}`)).status).toBe(
        204,
      );
      expect((await admin.get(`/therapists/${therapist.id}`)).status).toBe(404);
      expect((await admin.get('/therapists')).body.total).toBe(0);
      expect((await admin.delete(`/therapists/${therapist.id}`)).status).toBe(
        404,
      );

      const row = await prisma.therapist.findUniqueOrThrow({
        where: { id: therapist.id },
        include: { specializations: true, availability: true, timeOff: true },
      });
      expect(row.deletedAt).not.toBeNull();
      expect(row.membershipId).toBeNull();
      expect(row.specializations).toHaveLength(1);
      expect(row.availability).toHaveLength(1);
      expect(row.timeOff).toHaveLength(1);
      // The person's account is untouched, and can be linked to a new profile.
      expect((await staff.browser.get('/auth/me')).status).toBe(200);
      expect(
        (await createTherapist(admin, { membershipId: staff.membershipId }))
          .hasAccount,
      ).toBe(true);
    });
  });

  describe('staff account link', () => {
    it('links an optional staff account from the same center, once', async () => {
      const { browser: admin } = await registerCenter(app);
      const other = await registerCenter(app);
      const staff = await addStaff(app, admin, mail, {
        email: 'rahman@example.com',
        role: 'THERAPIST',
        fullName: 'Rahman Login',
      });
      const foreignStaff = await addStaff(app, other.browser, mail, {
        email: 'elsewhere@example.com',
        role: 'THERAPIST',
      });

      // Profiles work without a login; nothing creates one.
      const therapist = await createTherapist(admin);
      expect(therapist.hasAccount).toBe(false);
      const usersBefore = await prisma.user.count();

      const linked = await admin.patch(`/therapists/${therapist.id}`, {
        membershipId: staff.membershipId,
      });
      expect(linked.status).toBe(200);
      expect(linked.body.account).toMatchObject({
        membershipId: staff.membershipId,
        email: 'rahman@example.com',
      });
      expect(await prisma.user.count()).toBe(usersBefore);

      const second = await createTherapist(admin, { fullName: 'Other' });
      const taken = await admin.patch(`/therapists/${second.id}`, {
        membershipId: staff.membershipId,
      });
      expect(taken.status).toBe(409);
      expect(taken.body.code).toBe('ALREADY_LINKED');

      const foreign = await admin.patch(`/therapists/${second.id}`, {
        membershipId: foreignStaff.membershipId,
      });
      expect(foreign.status).toBe(400);
      expect(foreign.body.errors.membershipId).toBe('Staff member not found');

      const unlinked = await admin.patch(`/therapists/${therapist.id}`, {
        membershipId: null,
      });
      expect(unlinked.body.account).toBeNull();
    });
  });

  describe('access control', () => {
    it('keeps every center’s therapists to itself', async () => {
      const a = await registerCenter(app);
      const b = await registerCenter(app);
      const theirs = await createTherapist(b.browser);
      const base = `/therapists/${theirs.id}`;

      expect((await a.browser.get('/therapists')).body.total).toBe(0);
      for (const path of [
        base,
        `${base}/availability`,
        `${base}/time-off`,
        `${base}/specializations`,
      ]) {
        expect((await a.browser.get(path)).status).toBe(404);
      }
      expect(
        (
          await a.browser.get(
            `${base}/schedule?startDate=${dayFromToday(0)}&endDate=${dayFromToday(1)}`,
          )
        ).status,
      ).toBe(404);
      expect(
        (await a.browser.patch(base, { fullName: 'Hijacked' })).status,
      ).toBe(404);
      expect(
        (await a.browser.patch(`${base}/status`, { status: 'INACTIVE' }))
          .status,
      ).toBe(404);
      expect(
        (await a.browser.put(`${base}/availability`, week({}))).status,
      ).toBe(404);
      expect(
        (
          await a.browser.post(`${base}/time-off`, {
            startDate: dayFromToday(1),
            endDate: dayFromToday(1),
          })
        ).status,
      ).toBe(404);
      expect((await a.browser.delete(base)).status).toBe(404);

      const timeOff = await b.browser.post(`${base}/time-off`, {
        startDate: dayFromToday(1),
        endDate: dayFromToday(1),
      });
      const mine = await createTherapist(a.browser);
      // Another center's time off can't be reached through one of your own therapists.
      expect(
        (
          await a.browser.delete(
            `/therapists/${mine.id}/time-off/${timeOff.body.timeOff.id}`,
          )
        ).status,
      ).toBe(404);
      expect(
        (await prisma.therapist.findUniqueOrThrow({ where: { id: theirs.id } }))
          .fullName,
      ).toBe('Dr. Rahman');
    });

    it('enforces each role’s therapist permissions', async () => {
      const { browser: admin } = await registerCenter(app);
      const manager = await addStaff(app, admin, mail, {
        email: 'm@example.com',
        role: 'MANAGER',
      });
      const reception = await addStaff(app, admin, mail, {
        email: 'r@example.com',
        role: 'RECEPTIONIST',
      });
      const therapist = await createTherapist(admin);
      const base = `/therapists/${therapist.id}`;
      const timeOff = { startDate: dayFromToday(2), endDate: dayFromToday(2) };

      // Manager: runs therapists and schedules, but can't delete profiles.
      expect(
        (
          await manager.browser.post('/therapists', {
            fullName: 'M',
            mobile: '01711000111',
          })
        ).status,
      ).toBe(201);
      expect(
        (await manager.browser.patch(base, { designation: 'Lead' })).status,
      ).toBe(200);
      expect(
        (
          await manager.browser.put(
            `${base}/availability`,
            week({ [SAT]: [['09:00', '10:00']] }),
          )
        ).status,
      ).toBe(200);
      expect(
        (await manager.browser.post(`${base}/time-off`, timeOff)).status,
      ).toBe(201);
      expect(
        (await manager.browser.patch(`${base}/status`, { status: 'INACTIVE' }))
          .status,
      ).toBe(200);
      expect((await manager.browser.delete(base)).status).toBe(403);

      // Receptionist: reads therapists and schedules for booking, changes nothing.
      expect((await reception.browser.get('/therapists')).body.total).toBe(2);
      expect((await reception.browser.get(`${base}/availability`)).status).toBe(
        200,
      );
      expect((await reception.browser.get(`${base}/time-off`)).status).toBe(
        200,
      );
      expect(
        (
          await reception.browser.post('/therapists', {
            fullName: 'R',
            mobile: '01711000111',
          })
        ).status,
      ).toBe(403);
      expect(
        (await reception.browser.patch(base, { designation: 'X' })).status,
      ).toBe(403);
      expect(
        (await reception.browser.patch(`${base}/status`, { status: 'ACTIVE' }))
          .status,
      ).toBe(403);
      expect(
        (await reception.browser.put(`${base}/availability`, week({}))).status,
      ).toBe(403);
      expect(
        (await reception.browser.post(`${base}/time-off`, timeOff)).status,
      ).toBe(403);
      expect((await reception.browser.delete(base)).status).toBe(403);
    });

    it('shows a therapist only their own profile and schedule', async () => {
      const { browser: admin } = await registerCenter(app);
      const staff = await addStaff(app, admin, mail, {
        email: 'own@example.com',
        role: 'THERAPIST',
      });
      const unlinkedStaff = await addStaff(app, admin, mail, {
        email: 'nolink@example.com',
        role: 'THERAPIST',
      });
      const own = await createTherapist(admin, {
        fullName: 'Me',
        membershipId: staff.membershipId,
      });
      const colleague = await createTherapist(admin, {
        fullName: 'Colleague',
        notes: 'Private',
      });
      const me = staff.browser;

      const list = (await me.get('/therapists')).body;
      expect(list.total).toBe(1);
      expect(list.items[0]).toMatchObject({ id: own.id, isYou: true });
      expect((await me.get(`/therapists/${own.id}`)).status).toBe(200);
      expect((await me.get(`/therapists/${own.id}/availability`)).status).toBe(
        200,
      );
      expect(
        (
          await me.get(
            `/therapists/${own.id}/schedule?startDate=${dayFromToday(0)}&endDate=${dayFromToday(6)}`,
          )
        ).status,
      ).toBe(200);

      // Colleagues' records look like they don't exist, even with the same role.
      for (const path of [
        '',
        '/availability',
        '/time-off',
        '/specializations',
      ]) {
        expect(
          (await me.get(`/therapists/${colleague.id}${path}`)).status,
        ).toBe(404);
      }
      // Reading their own profile doesn't let them change it.
      expect(
        (await me.patch(`/therapists/${own.id}`, { fullName: 'X' })).status,
      ).toBe(403);
      expect(
        (await me.put(`/therapists/${own.id}/availability`, week({}))).status,
      ).toBe(403);
      expect(
        (
          await me.post(`/therapists/${own.id}/time-off`, {
            startDate: dayFromToday(1),
            endDate: dayFromToday(1),
          })
        ).status,
      ).toBe(403);

      // No linked profile: nothing to see.
      expect((await unlinkedStaff.browser.get('/therapists')).body.total).toBe(
        0,
      );
    });
  });
});
