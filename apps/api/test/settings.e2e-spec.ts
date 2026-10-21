import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { formatIsoDate, todayIn } from '../src/common/time';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  Browser,
  FakeMail,
  addStaff,
  createTestApp,
  registerCenter,
  registration,
  resetDatabase,
} from './helpers';

interface DurationOption {
  id: string;
  durationMinutes: number;
  label: string | null;
  isActive: boolean;
  isDefault: boolean;
}

interface TherapyType {
  id: string;
  name: string;
  code: string;
  defaultDurationMinutes: number;
  isActive: boolean;
  displayOrder: number;
  durationOptions: DurationOption[];
}

const physio = {
  name: 'Physiotherapy',
  code: 'pt',
  description: 'Movement and strength.',
  defaultDurationMinutes: 45,
  color: '#2563EB',
};

/** A week with every day closed, to adjust per test. */
function closedWeek() {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    intervals: [] as { start: string; end: string }[],
  }));
}

/** An ISO date `offset` days from today in Dhaka, the test centers' time zone. */
function dayFromToday(offset: number) {
  const today = todayIn('Asia/Dhaka');
  return formatIsoDate(new Date(today.getTime() + offset * 86_400_000));
}

describe('Therapy types and center settings (e2e)', () => {
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

  async function createType(admin: Browser, body: object = physio) {
    const res = await admin.post('/therapy-types', body);
    expect(res.status).toBe(201);
    return res.body as TherapyType;
  }

  describe('default configuration', () => {
    it('starts a new center with editable OT, ABA and SLT, hours and settings', async () => {
      const { browser: admin } = await registerCenter(app);

      const types = (await admin.get('/therapy-types')).body as TherapyType[];
      expect(types.map((t) => t.code)).toEqual(['OT', 'ABA', 'SLT']);
      const ot = types[0];
      expect(ot.defaultDurationMinutes).toBe(45);
      expect(ot.durationOptions.map((o) => o.durationMinutes)).toEqual([
        30, 45, 60,
      ]);
      expect(ot.durationOptions.filter((o) => o.isDefault)).toHaveLength(1);

      // They're ordinary records: rename, retime, recolour and deactivate them.
      const renamed = await admin.patch(`/therapy-types/${ot.id}`, {
        name: 'OT (sensory integration)',
        defaultDurationMinutes: 60,
        color: '#123456',
        description: '',
      });
      expect(renamed.status).toBe(200);
      expect(renamed.body).toMatchObject({
        id: ot.id,
        name: 'OT (sensory integration)',
        defaultDurationMinutes: 60,
        color: '#123456',
        description: null,
      });
      expect(
        (
          await admin.patch(`/therapy-types/${ot.id}/status`, {
            isActive: false,
          })
        ).body.isActive,
      ).toBe(false);

      const hours = await admin.get('/settings/working-hours');
      expect(hours.body.timezone).toBe('Asia/Dhaka');
      const friday = hours.body.days[5];
      expect(friday).toEqual({ dayOfWeek: 5, isOpen: false, intervals: [] });
      expect(hours.body.days[6].intervals).toEqual([
        { start: '09:00', end: '18:00' },
      ]);

      const scheduling = await admin.get('/settings/scheduling');
      expect(scheduling.body).toMatchObject({
        slotIntervalMinutes: 15,
        allowDoubleBooking: false,
      });
      const general = await admin.get('/settings/general');
      expect(general.body).toMatchObject({
        autoGeneratePatientCode: true,
        defaultPatientStatus: 'ACTIVE',
      });
    });

    it('can skip the default therapy types and works with none', async () => {
      const admin = await new Browser(app).init();
      const body = { ...registration(), defaultTherapyTypes: false };
      expect((await admin.post('/auth/register-center', body)).status).toBe(
        201,
      );
      const list = await admin.get('/therapy-types');
      expect(list.status).toBe(200);
      expect(list.body).toEqual([]);

      const seeded = await admin.post('/therapy-types/defaults');
      expect(seeded.status).toBe(200);
      expect(seeded.body.created).toBe(3);
    });

    it('adds the defaults idempotently, only filling in what’s missing', async () => {
      const { browser: admin } = await registerCenter(app);
      const again = await admin.post('/therapy-types/defaults');
      expect(again.body.created).toBe(0);
      expect(again.body.items).toHaveLength(3);

      const aba = (again.body.items as TherapyType[]).find(
        (t) => t.code === 'ABA',
      )!;
      expect((await admin.delete(`/therapy-types/${aba.id}`)).status).toBe(204);
      const refill = await admin.post('/therapy-types/defaults');
      expect(refill.body.created).toBe(1);
      expect(
        (refill.body.items as TherapyType[]).map((t) => t.code).sort(),
      ).toEqual(['ABA', 'OT', 'SLT']);
      expect(await prisma.therapyType.count()).toBe(3);
    });
  });

  describe('therapy types', () => {
    it('creates a therapy type with its default duration as the first option', async () => {
      const { browser: admin } = await registerCenter(app);
      const created = await createType(admin);
      expect(created).toMatchObject({
        name: 'Physiotherapy',
        code: 'PT',
        color: '#2563eb',
        isActive: true,
        defaultDurationMinutes: 45,
        displayOrder: 3,
      });
      expect(created.durationOptions).toEqual([
        expect.objectContaining({ durationMinutes: 45, isDefault: true }),
      ]);
      const fetched = await admin.get(`/therapy-types/${created.id}`);
      expect(fetched.body.id).toBe(created.id);
    });

    it('keeps names and codes unique within a center', async () => {
      const { browser: admin } = await registerCenter(app);
      await createType(admin);

      const sameCode = await admin.post('/therapy-types', {
        ...physio,
        name: 'Physio (paediatric)',
        code: ' PT ',
      });
      expect(sameCode.status).toBe(409);
      expect(sameCode.body.errors).toEqual({
        code: 'Another therapy type already uses this code',
      });

      const sameName = await admin.post('/therapy-types', {
        ...physio,
        name: 'PHYSIOTHERAPY',
        code: 'PHY',
      });
      expect(sameName.status).toBe(409);
      expect(sameName.body.errors.name).toBeDefined();

      // Renaming another type onto an existing code is caught too.
      const ot = ((await admin.get('/therapy-types')).body as TherapyType[])[0];
      const clash = await admin.patch(`/therapy-types/${ot.id}`, {
        code: 'pt',
      });
      expect(clash.status).toBe(409);
      // Changing only the case of its own name is fine.
      const recased = await admin.patch(`/therapy-types/${ot.id}`, {
        name: 'occupational therapy',
      });
      expect(recased.status).toBe(200);
    });

    it('lets different centers use the same code', async () => {
      const a = await registerCenter(app);
      const b = await registerCenter(app);
      await createType(a.browser);
      const inB = await b.browser.post('/therapy-types', physio);
      expect(inB.status).toBe(201);
      // Each center also has its own OT.
      expect(await prisma.therapyType.count({ where: { code: 'OT' } })).toBe(2);
    });

    it('edits a therapy type without changing its identity', async () => {
      const { browser: admin } = await registerCenter(app);
      const pt = await createType(admin);
      const res = await admin.patch(`/therapy-types/${pt.id}`, {
        name: 'Physical Therapy',
        code: 'PHT',
        defaultDurationMinutes: 60,
      });
      expect(res.status).toBe(200);
      const updated = res.body as TherapyType;
      expect(updated).toMatchObject({
        id: pt.id,
        name: 'Physical Therapy',
        code: 'PHT',
        defaultDurationMinutes: 60,
      });
      // The new default became an option; the old one is kept, no longer default.
      expect(
        updated.durationOptions.map((o) => [o.durationMinutes, o.isDefault]),
      ).toEqual([
        [45, false],
        [60, true],
      ]);

      // Required fields can't be cleared; unknown fields are rejected.
      expect(
        (await admin.patch(`/therapy-types/${pt.id}`, { name: null })).status,
      ).toBe(400);
      expect(
        (await admin.patch(`/therapy-types/${pt.id}`, { centerId: 'x' }))
          .status,
      ).toBe(400);
    });

    it('activates and deactivates, and filters and searches the list', async () => {
      const { browser: admin } = await registerCenter(app);
      const pt = await createType(admin);

      const off = await admin.patch(`/therapy-types/${pt.id}/status`, {
        isActive: false,
      });
      expect(off.status).toBe(200);
      expect(off.body.isActive).toBe(false);

      const inactive = await admin.get('/therapy-types?status=INACTIVE');
      expect((inactive.body as TherapyType[]).map((t) => t.code)).toEqual([
        'PT',
      ]);
      const active = await admin.get('/therapy-types?status=ACTIVE');
      expect(active.body).toHaveLength(3);
      const search = await admin.get('/therapy-types?search=speech');
      expect((search.body as TherapyType[]).map((t) => t.code)).toEqual([
        'SLT',
      ]);

      const on = await admin.patch(`/therapy-types/${pt.id}/status`, {
        isActive: true,
      });
      expect(on.body.isActive).toBe(true);
    });

    it('reorders therapy types from a complete list', async () => {
      const { browser: admin } = await registerCenter(app);
      const types = (await admin.get('/therapy-types')).body as TherapyType[];
      const ids = types.map((t) => t.id).reverse();

      const res = await admin.put('/therapy-types/order', { ids });
      expect(res.status).toBe(200);
      expect((res.body as TherapyType[]).map((t) => t.code)).toEqual([
        'SLT',
        'ABA',
        'OT',
      ]);
      // A stale or partial list is refused rather than half-applied.
      const partial = await admin.put('/therapy-types/order', {
        ids: ids.slice(1),
      });
      expect(partial.status).toBe(409);
      expect(partial.body.code).toBe('LIST_CHANGED');
    });

    it('refuses to delete a therapy type that other records reference', async () => {
      const { browser: admin } = await registerCenter(app);
      const pt = await createType(admin);
      // Stands in for future modules (patients, appointments, packages), which
      // reference therapy types with ON DELETE RESTRICT.
      await prisma.$executeRawUnsafe(
        'CREATE TABLE "TestTherapyReference" (id serial PRIMARY KEY, "therapyTypeId" uuid NOT NULL REFERENCES "TherapyType"(id) ON DELETE RESTRICT)',
      );
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "TestTherapyReference" ("therapyTypeId") VALUES ('${pt.id}')`,
        );
        const res = await admin.delete(`/therapy-types/${pt.id}`);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('IN_USE');
        expect((await admin.get(`/therapy-types/${pt.id}`)).status).toBe(200);
      } finally {
        await prisma.$executeRawUnsafe('DROP TABLE "TestTherapyReference"');
      }

      // Once nothing refers to it, it can go.
      expect((await admin.delete(`/therapy-types/${pt.id}`)).status).toBe(204);
      expect((await admin.get(`/therapy-types/${pt.id}`)).status).toBe(404);
      expect(
        await prisma.therapyDurationOption.count({
          where: { therapyTypeId: pt.id },
        }),
      ).toBe(0);
    });

    it('rejects invalid durations', async () => {
      const { browser: admin } = await registerCenter(app);
      for (const defaultDurationMinutes of [-30, 0, 4, 481, 45.5, '45', null]) {
        const res = await admin.post('/therapy-types', {
          ...physio,
          defaultDurationMinutes,
        });
        expect(res.status).toBe(400);
        expect(res.body.errors.defaultDurationMinutes).toMatch(
          /between 5 and 480 minutes/,
        );
      }
      const pt = await createType(admin);
      const bad = await admin.post(`/therapy-types/${pt.id}/durations`, {
        durationMinutes: -15,
      });
      expect(bad.status).toBe(400);
      expect(bad.body.errors.durationMinutes).toBeDefined();
    });
  });

  describe('duration options', () => {
    it('configures several durations with exactly one default', async () => {
      const { browser: admin } = await registerCenter(app);
      const pt = await createType(admin);
      const base = `/therapy-types/${pt.id}/durations`;

      expect((await admin.post(base, { durationMinutes: 30 })).status).toBe(
        201,
      );
      const withSixty = await admin.post(base, {
        durationMinutes: 60,
        label: 'Extended',
      });
      expect(withSixty.status).toBe(201);
      const options = (await admin.get(base)).body as DurationOption[];
      expect(options.map((o) => o.durationMinutes)).toEqual([30, 45, 60]);

      // The same length can't be offered twice.
      const dup = await admin.post(base, { durationMinutes: 30 });
      expect(dup.status).toBe(409);
      expect(dup.body.errors.durationMinutes).toBeDefined();

      // Moving the default leaves exactly one.
      const sixty = options.find((o) => o.durationMinutes === 60)!;
      const moved = await admin.patch(`${base}/${sixty.id}`, {
        isDefault: true,
      });
      expect(moved.status).toBe(200);
      expect(moved.body.defaultDurationMinutes).toBe(60);
      const defaults = (moved.body as TherapyType).durationOptions.filter(
        (o) => o.isDefault,
      );
      expect(defaults.map((o) => o.durationMinutes)).toEqual([60]);

      // A default can't be unset, removed or switched off.
      expect(
        (await admin.patch(`${base}/${sixty.id}`, { isDefault: false })).status,
      ).toBe(400);
      const remove = await admin.delete(`${base}/${sixty.id}`);
      expect(remove.status).toBe(409);
      expect(remove.body.code).toBe('DEFAULT_DURATION');
      expect(
        (await admin.patch(`${base}/${sixty.id}`, { isActive: false })).status,
      ).toBe(409);

      // Changing the default option's length moves the type's default with it.
      const retimed = await admin.patch(`${base}/${sixty.id}`, {
        durationMinutes: 75,
      });
      expect(retimed.body.defaultDurationMinutes).toBe(75);

      // Other options can be switched off and removed.
      const thirty = options.find((o) => o.durationMinutes === 30)!;
      const off = await admin.patch(`${base}/${thirty.id}`, {
        isActive: false,
      });
      expect(
        (off.body as TherapyType).durationOptions.find(
          (o) => o.id === thirty.id,
        )?.isActive,
      ).toBe(false);
      expect((await admin.delete(`${base}/${thirty.id}`)).status).toBe(200);
      expect(
        await prisma.therapyDurationOption.count({
          where: { therapyTypeId: pt.id },
        }),
      ).toBe(2);
    });
  });

  describe('working hours', () => {
    it('saves split shifts and closed days', async () => {
      const { browser: admin } = await registerCenter(app);
      const days = closedWeek();
      days[6].intervals = [
        { start: '14:00', end: '18:00' },
        { start: '09:00', end: '13:00' },
      ];
      days[0].intervals = [{ start: '10:00', end: '16:00' }];

      const res = await admin.put('/settings/working-hours', { days });
      expect(res.status).toBe(200);
      const saved = (await admin.get('/settings/working-hours')).body;
      expect(saved.days[6]).toEqual({
        dayOfWeek: 6,
        isOpen: true,
        intervals: [
          { start: '09:00', end: '13:00' },
          { start: '14:00', end: '18:00' },
        ],
      });
      for (const day of [1, 2, 3, 4, 5]) {
        expect(saved.days[day]).toEqual({
          dayOfWeek: day,
          isOpen: false,
          intervals: [],
        });
      }
    });

    it('rejects overlapping and inverted intervals without saving anything', async () => {
      const { browser: admin } = await registerCenter(app);
      const before = (await admin.get('/settings/working-hours')).body;
      const days = closedWeek();
      days[1].intervals = [
        { start: '09:00', end: '13:00' },
        { start: '12:00', end: '15:00' },
      ];
      days[2].intervals = [{ start: '17:00', end: '09:00' }];

      const res = await admin.put('/settings/working-hours', { days });
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual({
        'days.1.intervals.1.start': 'Overlaps 09:00–13:00',
        'days.2.intervals.0.end': 'Closing time must be after opening time',
      });
      expect((await admin.get('/settings/working-hours')).body).toEqual(before);

      // The whole week is required, each day once.
      const short = await admin.put('/settings/working-hours', {
        days: days.slice(0, 6),
      });
      expect(short.status).toBe(400);
    });
  });

  describe('closures', () => {
    it('supports multi-day closures and splits upcoming from past', async () => {
      const { browser: admin } = await registerCenter(app);
      const eid = await admin.post('/settings/closures', {
        title: 'Eid holidays',
        startDate: dayFromToday(10),
        endDate: dayFromToday(13),
        reason: 'Eid-ul-Adha',
      });
      expect(eid.status).toBe(201);
      expect(eid.body).toMatchObject({
        title: 'Eid holidays',
        days: 4,
        allDay: true,
        state: 'upcoming',
        canDelete: true,
      });

      const past = await admin.post('/settings/closures', {
        title: 'Maintenance',
        startDate: dayFromToday(-20),
        endDate: dayFromToday(-20),
        allDay: false,
        startTime: '13:00',
        endTime: '17:00',
      });
      expect(past.status).toBe(201);
      expect(past.body).toMatchObject({
        state: 'past',
        startTime: '13:00',
        endTime: '17:00',
        canDelete: false,
      });

      const upcoming = await admin.get('/settings/closures?period=upcoming');
      expect(upcoming.body.map((c: { title: string }) => c.title)).toEqual([
        'Eid holidays',
      ]);
      const previous = await admin.get('/settings/closures?period=past');
      expect(previous.body.map((c: { title: string }) => c.title)).toEqual([
        'Maintenance',
      ]);

      // A closure that already happened is kept; it can be deactivated instead.
      const del = await admin.delete(`/settings/closures/${past.body.id}`);
      expect(del.status).toBe(409);
      expect(
        (
          await admin.patch(`/settings/closures/${past.body.id}`, {
            isActive: false,
          })
        ).body.isActive,
      ).toBe(false);
      expect(
        (await admin.delete(`/settings/closures/${eid.body.id}`)).status,
      ).toBe(204);
    });

    it('validates closure dates and times', async () => {
      const { browser: admin } = await registerCenter(app);
      const backwards = await admin.post('/settings/closures', {
        title: 'Backwards',
        startDate: dayFromToday(5),
        endDate: dayFromToday(3),
      });
      expect(backwards.status).toBe(400);
      expect(backwards.body.errors.endDate).toBeDefined();

      const partMultiDay = await admin.post('/settings/closures', {
        title: 'Half days',
        startDate: dayFromToday(3),
        endDate: dayFromToday(4),
        allDay: false,
        startTime: '09:00',
        endTime: '12:00',
      });
      expect(partMultiDay.status).toBe(400);
      expect(partMultiDay.body.errors.endDate).toBeDefined();

      const noTimes = await admin.post('/settings/closures', {
        title: 'Afternoon off',
        startDate: dayFromToday(3),
        endDate: dayFromToday(3),
        allDay: false,
      });
      expect(noTimes.status).toBe(400);
      expect(Object.keys(noTimes.body.errors as object).sort()).toEqual([
        'endTime',
        'startTime',
      ]);

      const impossible = await admin.post('/settings/closures', {
        title: 'Nope',
        startDate: '2026-02-30',
        endDate: '2026-03-01',
      });
      expect(impossible.status).toBe(400);
    });
  });

  describe('scheduling and general settings', () => {
    it('persists independently per center, with partial updates', async () => {
      const a = await registerCenter(app);
      const b = await registerCenter(app);

      const res = await a.browser.patch('/settings/scheduling', {
        slotIntervalMinutes: 30,
        allowDoubleBooking: true,
        cancellationCutoffMinutes: 720,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        slotIntervalMinutes: 30,
        allowDoubleBooking: true,
        cancellationCutoffMinutes: 720,
        // Untouched fields keep their values.
        advanceBookingLimitDays: 60,
        allowPastDateBooking: false,
      });

      const inB = (await b.browser.get('/settings/scheduling')).body;
      expect(inB).toMatchObject({
        slotIntervalMinutes: 15,
        allowDoubleBooking: false,
        cancellationCutoffMinutes: 0,
      });

      const general = await a.browser.patch('/settings/general', {
        patientCodePrefix: ' sb- ',
        timeFormat: 'H24',
        dateFormat: 'DD_MM_YYYY',
      });
      expect(general.body).toMatchObject({
        patientCodePrefix: 'SB-',
        timeFormat: 'H24',
        autoGeneratePatientCode: true,
      });
      expect((await b.browser.get('/settings/general')).body.timeFormat).toBe(
        'H12',
      );
      // Clearing the prefix
      expect(
        (await a.browser.patch('/settings/general', { patientCodePrefix: '' }))
          .body.patientCodePrefix,
      ).toBeNull();
    });

    it('validates values and units', async () => {
      const { browser: admin } = await registerCenter(app);
      for (const body of [
        { slotIntervalMinutes: 7 },
        { bookingBufferMinutes: -5 },
        { advanceBookingLimitDays: 0 },
        { minimumBookingNoticeMinutes: 50_000 },
        { allowDoubleBooking: 'yes' },
        { allowDoubleBooking: null },
        { unknownSetting: true },
      ]) {
        expect((await admin.patch('/settings/scheduling', body)).status).toBe(
          400,
        );
      }
      for (const body of [
        { defaultPatientStatus: 'DISCHARGED' },
        { dateFormat: 'dd.mm.yy' },
        { weekStartsOn: 7 },
        { patientCodePrefix: 'TOO-LONG-PREFIX' },
      ]) {
        expect((await admin.patch('/settings/general', body)).status).toBe(400);
      }
    });
  });

  describe('access control', () => {
    it('lets every role read the configuration but only admins change it', async () => {
      const { browser: admin } = await registerCenter(app);
      const ot = ((await admin.get('/therapy-types')).body as TherapyType[])[0];
      const closure = await admin.post('/settings/closures', {
        title: 'Holiday',
        startDate: dayFromToday(30),
        endDate: dayFromToday(30),
      });

      for (const role of ['MANAGER', 'RECEPTIONIST', 'THERAPIST']) {
        const { browser } = await addStaff(app, admin, mail, {
          email: `${role.toLowerCase()}@example.com`,
          role,
        });
        for (const path of [
          '/therapy-types',
          `/therapy-types/${ot.id}`,
          `/therapy-types/${ot.id}/durations`,
          '/settings/working-hours',
          '/settings/closures',
          '/settings/scheduling',
          '/settings/general',
        ]) {
          expect([role, path, (await browser.get(path)).status]).toEqual([
            role,
            path,
            200,
          ]);
        }
        const writes = [
          () => browser.post('/therapy-types', physio),
          () => browser.post('/therapy-types/defaults'),
          () => browser.patch(`/therapy-types/${ot.id}`, { name: 'Hijacked' }),
          () =>
            browser.patch(`/therapy-types/${ot.id}/status`, {
              isActive: false,
            }),
          () => browser.put('/therapy-types/order', { ids: [ot.id] }),
          () => browser.delete(`/therapy-types/${ot.id}`),
          () =>
            browser.post(`/therapy-types/${ot.id}/durations`, {
              durationMinutes: 90,
            }),
          () =>
            browser.delete(
              `/therapy-types/${ot.id}/durations/${ot.durationOptions[0].id}`,
            ),
          () => browser.put('/settings/working-hours', { days: closedWeek() }),
          () =>
            browser.post('/settings/closures', {
              title: 'X',
              startDate: dayFromToday(1),
              endDate: dayFromToday(1),
            }),
          () =>
            browser.patch(`/settings/closures/${closure.body.id}`, {
              title: 'X',
            }),
          () => browser.delete(`/settings/closures/${closure.body.id}`),
          () =>
            browser.patch('/settings/scheduling', { allowDoubleBooking: true }),
          () => browser.patch('/settings/general', { timeFormat: 'H24' }),
        ];
        const statuses: number[] = [];
        for (const write of writes) statuses.push((await write()).status);
        expect({ role, statuses }).toEqual({
          role,
          statuses: writes.map(() => 403),
        });
      }
      // Nothing changed.
      expect((await admin.get(`/therapy-types/${ot.id}`)).body.name).toBe(
        'Occupational Therapy',
      );
      expect(
        (await admin.get('/settings/scheduling')).body.allowDoubleBooking,
      ).toBe(false);
    });

    it('requires a session', async () => {
      const server = app.getHttpServer();
      for (const path of [
        '/therapy-types',
        '/settings/working-hours',
        '/settings/closures',
        '/settings/scheduling',
        '/settings/general',
      ]) {
        expect((await request(server).get(path)).status).toBe(401);
      }
    });

    it('treats another center’s configuration as if it didn’t exist', async () => {
      const a = await registerCenter(app);
      const b = await registerCenter(app);
      const aType = await createType(a.browser);
      const aOption = aType.durationOptions[0];
      const aClosure = (
        await a.browser.post('/settings/closures', {
          title: 'A only',
          startDate: dayFromToday(5),
          endDate: dayFromToday(6),
        })
      ).body;

      const attempts = [
        () => b.browser.get(`/therapy-types/${aType.id}`),
        () => b.browser.patch(`/therapy-types/${aType.id}`, { name: 'Stolen' }),
        () =>
          b.browser.patch(`/therapy-types/${aType.id}/status`, {
            isActive: false,
          }),
        () => b.browser.delete(`/therapy-types/${aType.id}`),
        () => b.browser.get(`/therapy-types/${aType.id}/durations`),
        () =>
          b.browser.post(`/therapy-types/${aType.id}/durations`, {
            durationMinutes: 90,
          }),
        () =>
          b.browser.patch(
            `/therapy-types/${aType.id}/durations/${aOption.id}`,
            {
              label: 'Stolen',
            },
          ),
        () => b.browser.get(`/settings/closures/${aClosure.id}`),
        () =>
          b.browser.patch(`/settings/closures/${aClosure.id}`, { title: 'X' }),
        () => b.browser.delete(`/settings/closures/${aClosure.id}`),
      ];
      const statuses: number[] = [];
      for (const attempt of attempts) statuses.push((await attempt()).status);
      expect(statuses).toEqual(attempts.map(() => 404));

      // B can't slip A's therapy type into its own ordering either.
      const bIds = (
        (await b.browser.get('/therapy-types')).body as TherapyType[]
      ).map((t) => t.id);
      expect(
        (
          await b.browser.put('/therapy-types/order', {
            ids: [...bIds, aType.id],
          })
        ).status,
      ).toBe(409);

      // Lists only ever show the caller's own center.
      const bTypes = (await b.browser.get('/therapy-types'))
        .body as TherapyType[];
      expect(bTypes.map((t) => t.id)).not.toContain(aType.id);
      expect((await b.browser.get('/settings/closures')).body).toEqual([]);

      // A's records are untouched.
      const after = (await a.browser.get(`/therapy-types/${aType.id}`)).body;
      expect(after).toMatchObject({ name: 'Physiotherapy', isActive: true });
      expect(after.durationOptions).toHaveLength(1);
    });
  });
});
