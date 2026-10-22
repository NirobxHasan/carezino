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

interface Contact {
  relationId: string;
  guardianId: string;
  contactType: 'GUARDIAN' | 'CAREGIVER';
  relationship: string;
  customRelationship: string | null;
  isPrimary: boolean;
  isEmergencyContact: boolean;
  guardian: {
    id: string;
    fullName: string;
    mobile: string;
    linkedPatientCount: number;
  };
}

interface Patient {
  id: string;
  code: string;
  fullName: string;
  gender: string | null;
  dateOfBirth: string | null;
  age: { years: number; months: number; isApproximate: boolean } | null;
  approximateAgeRecordedOn: string | null;
  status: 'NEW' | 'ACTIVE' | 'INACTIVE';
  mobile: string | null;
  email: string | null;
  primaryContactIsSelf: boolean;
  primaryContact: {
    type: 'SELF' | 'GUARDIAN' | 'CAREGIVER';
    name: string;
    mobile: string | null;
    relationship: string | null;
  } | null;
  therapyInterests: {
    therapyTypeId: string;
    code: string;
    isActive: boolean;
  }[];
  referralSource: string | null;
  referralOther: string | null;
  registeredBy: { id: string; fullName: string };
  registeredAt: string;
  contacts: Contact[];
  consents: {
    purpose: string;
    granted: boolean;
    givenBy: string;
    givenByName: string;
    guardianId: string | null;
    recordedBy: { fullName: string };
  }[];
}

interface Page {
  items: Patient[];
  total: number;
  page: number;
  pageSize: number;
}

interface GuardianMatch {
  id: string;
  fullName: string;
  mobile: string;
  linkedPatientCount: number;
  patients: { id: string; code: string; relationship: string }[];
}

const mother = {
  contactType: 'GUARDIAN',
  fullName: 'Nasrin Akter',
  mobile: '01711-222333',
  relationship: 'MOTHER',
};

describe('Patient & guardian management (e2e)', () => {
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
    const list = (await admin.get('/therapy-types')).body as {
      id: string;
      code: string;
    }[];
    return Object.fromEntries(list.map((t) => [t.code, t.id])) as Record<
      string,
      string
    >;
  }

  async function register(browser: Browser, body: object = {}) {
    const res = await browser.post('/patients', {
      fullName: 'Ayaan Rahman',
      contact: mother,
      ...body,
    });
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    return res.body as Patient;
  }

  async function list(browser: Browser, query = '') {
    const res = await browser.get(`/patients${query ? `?${query}` : ''}`);
    expect(res.status).toBe(200);
    return res.body as Page;
  }

  describe('registration', () => {
    it('registers a child with a new guardian, therapy interests and consent', async () => {
      const { browser: admin } = await registerCenter(app);
      await admin.patch('/settings/general', { patientCodePrefix: 'P-' });
      const t = await types(admin);
      const res = await admin.post('/patients', {
        fullName: '  Ayaan Rahman ',
        dateOfBirth: '2021-03-14',
        gender: 'MALE',
        primaryConcern: 'Delayed speech',
        therapyTypeIds: [t.SLT, t.OT],
        referralSource: 'SCHOOL',
        internalNotes: 'Prefers morning sessions',
        emergencyPhone: '01811-000999',
        contact: {
          ...mother,
          email: 'Nasrin@Example.com',
          address: 'Road 5, Dhanmondi',
          isEmergencyContact: true,
        },
        consents: [{ purpose: 'TREATMENT', version: 'Registration form v1' }],
      });
      expect(res.status).toBe(201);
      const p = res.body as Patient;
      expect(p).toMatchObject({
        code: 'P-0001',
        fullName: 'Ayaan Rahman',
        dateOfBirth: '2021-03-14',
        gender: 'MALE',
        status: 'NEW',
        age: { isApproximate: false },
        primaryContactIsSelf: false,
        // A guardian's details go on the guardian, not the patient.
        mobile: null,
        email: null,
        primaryContact: {
          type: 'GUARDIAN',
          name: 'Nasrin Akter',
          mobile: '01711222333',
          relationship: 'MOTHER',
        },
        referralSource: 'SCHOOL',
        referralOther: null,
        registeredBy: { fullName: 'Kamrul Islam' },
      });
      // Ordered as the center orders its therapy types (OT, ABA, SLT).
      expect(p.therapyInterests.map((i) => i.code)).toEqual(['OT', 'SLT']);
      expect(p.contacts).toHaveLength(1);
      expect(p.contacts[0]).toMatchObject({
        contactType: 'GUARDIAN',
        isPrimary: true,
        isEmergencyContact: true,
        guardian: { fullName: 'Nasrin Akter', linkedPatientCount: 1 },
      });
      expect(p.consents).toEqual([
        expect.objectContaining({
          purpose: 'TREATMENT',
          granted: true,
          givenBy: 'GUARDIAN',
          givenByName: 'Nasrin Akter',
          guardianId: p.contacts[0].guardianId,
          recordedBy: expect.objectContaining({ fullName: 'Kamrul Islam' }),
        }),
      ]);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'patient.registered', entityId: p.id },
      });
      // Codes and IDs only: no names or health details in the audit log.
      expect(JSON.stringify(audit.metadata)).not.toContain('Ayaan');
      expect(JSON.stringify(audit.metadata)).not.toContain('speech');
    });

    it('registers an adult who is their own contact, with no guardian', async () => {
      const { browser: admin } = await registerCenter(app);
      const p = await register(admin, {
        fullName: 'Farhana Haque',
        approximateAge: { years: 34 },
        gender: 'PREFER_NOT_TO_SAY',
        contact: {
          contactType: 'SELF',
          mobile: '+880 1912-345678',
          email: 'farhana@example.com',
          address: 'Mirpur 10',
        },
        consents: [{ purpose: 'TREATMENT' }, { purpose: 'DATA_PROCESSING' }],
      });
      const today = formatIsoDate(todayIn('Asia/Dhaka'));
      expect(p).toMatchObject({
        code: '0001',
        mobile: '01912345678',
        email: 'farhana@example.com',
        primaryContactIsSelf: true,
        dateOfBirth: null,
        age: { years: 34, months: 0, isApproximate: true },
        approximateAgeRecordedOn: today,
        primaryContact: {
          type: 'SELF',
          name: 'Farhana Haque',
          mobile: '01912345678',
        },
        contacts: [],
      });
      expect(
        p.consents.map((c) => [c.purpose, c.givenBy, c.givenByName]),
      ).toEqual(
        expect.arrayContaining([
          ['TREATMENT', 'SELF', 'Farhana Haque'],
          ['DATA_PROCESSING', 'SELF', 'Farhana Haque'],
        ]),
      );
      expect(await prisma.guardian.count()).toBe(0);
    });

    it('validates the registration form', async () => {
      const { browser: admin } = await registerCenter(app);
      const res = await admin.post('/patients', {
        fullName: ' ',
        contact: { contactType: 'GUARDIAN', mobile: '12345' },
      });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.errors as object).sort()).toEqual([
        'contact.fullName',
        'contact.mobile',
        'contact.relationship',
        'fullName',
      ]);
      // A missing value reports that it's required, not its length limit.
      expect(res.body.errors).toMatchObject({
        fullName: 'Full name is required',
        'contact.fullName': 'Contact name is required',
      });

      const missing = await admin.post('/patients', { fullName: 'No Contact' });
      expect(missing.status).toBe(400);
      expect(missing.body.errors).toHaveProperty('contact');

      const custom = await admin.post('/patients', {
        fullName: 'Rafi',
        contact: { ...mother, relationship: 'OTHER' },
      });
      expect(custom.body.errors).toEqual({
        'contact.customRelationship': 'Describe the relationship',
      });

      const both = await admin.post('/patients', {
        fullName: 'Rafi',
        dateOfBirth: '2020-01-01',
        approximateAge: { years: 6 },
        contact: mother,
      });
      expect(both.body.errors).toHaveProperty('approximateAge');

      const future = formatIsoDate(addDays(todayIn('Asia/Dhaka'), 2));
      const unborn = await admin.post('/patients', {
        fullName: 'Rafi',
        dateOfBirth: future,
        contact: mother,
      });
      expect(unborn.body.errors).toHaveProperty('dateOfBirth');

      const referral = await admin.post('/patients', {
        fullName: 'Rafi',
        referralSource: 'OTHER',
        contact: mother,
      });
      expect(referral.body.errors).toHaveProperty('referralOther');

      const inactive = await admin.post('/patients', {
        fullName: 'Rafi',
        status: 'INACTIVE',
        contact: mother,
      });
      expect(inactive.body.errors).toHaveProperty('status');

      // Codes are generated here, so one can't be chosen.
      const code = await admin.post('/patients', {
        fullName: 'Rafi',
        code: 'X-1',
        contact: mother,
      });
      expect(code.body.code).toBe('CODE_AUTOMATIC');
      expect(await prisma.patient.count()).toBe(0);
    });

    it('starts patients at the center’s default status', async () => {
      const { browser: admin } = await registerCenter(app);
      expect((await register(admin)).status).toBe('NEW');
      await admin.patch('/settings/general', {
        defaultPatientStatus: 'ACTIVE',
      });
      expect((await register(admin, { fullName: 'Second' })).status).toBe(
        'ACTIVE',
      );
      expect(
        (await register(admin, { fullName: 'Third', status: 'NEW' })).status,
      ).toBe('NEW');
    });

    it('gives concurrent registrations distinct, sequential codes', async () => {
      const { browser: admin } = await registerCenter(app);
      await admin.patch('/settings/general', { patientCodePrefix: 'PT-' });
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          admin.post('/patients', {
            fullName: `Child ${i + 1}`,
            contact: { ...mother, mobile: `0171100000${i}` },
          }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
      const codes = results.map((r) => (r.body as Patient).code).sort();
      expect(codes).toEqual(
        Array.from({ length: 8 }, (_, i) => `PT-000${i + 1}`),
      );
      // Numbers aren't reused once a patient is deleted.
      await admin.delete(`/patients/${(results[7].body as Patient).id}`);
      expect((await register(admin, { fullName: 'Ninth' })).code).toBe(
        'PT-0009',
      );
    });

    it('takes typed codes when the center doesn’t generate them', async () => {
      const { browser: admin } = await registerCenter(app);
      await admin.patch('/settings/general', {
        autoGeneratePatientCode: false,
      });
      const none = await admin.post('/patients', {
        fullName: 'Rafi',
        contact: mother,
      });
      expect(none.body.errors).toHaveProperty('code');
      const p = await register(admin, { code: ' sb-2024-17 ' });
      expect(p.code).toBe('SB-2024-17');
      const dupe = await admin.post('/patients', {
        fullName: 'Other',
        code: 'SB-2024-17',
        contact: mother,
      });
      expect(dupe.status).toBe(409);
      expect(dupe.body.errors).toHaveProperty('code');
      // Typed codes can be corrected; generated ones can't.
      const fixed = await admin.patch(`/patients/${p.id}`, {
        code: 'SB-2024-18',
      });
      expect((fixed.body as Patient).code).toBe('SB-2024-18');

      await register(admin, { fullName: 'Typed', code: '0001' });

      // Turning generation back on skips codes already typed by hand.
      await admin.patch('/settings/general', { autoGeneratePatientCode: true });
      expect((await register(admin, { fullName: 'Generated' })).code).toBe(
        '0002',
      );
      const locked = await admin.patch(`/patients/${p.id}`, { code: 'NEW-1' });
      expect(locked.body.code).toBe('CODE_AUTOMATIC');
    });
  });

  describe('editing', () => {
    it('updates profile fields, age and therapy interests without touching contacts', async () => {
      const { browser: admin } = await registerCenter(app);
      const t = await types(admin);
      const p = await register(admin, {
        approximateAge: { years: 4, months: 6 },
        therapyTypeIds: [t.OT],
      });
      expect(p.age).toEqual({ years: 4, months: 6, isApproximate: true });

      const res = await admin.patch(`/patients/${p.id}`, {
        fullName: 'Ayaan R. Chowdhury',
        dateOfBirth: '2021-05-02',
        gender: '',
        therapyTypeIds: [t.ABA, t.SLT],
        referralSource: 'OTHER',
        referralOther: 'Pediatric clinic',
      });
      expect(res.status).toBe(200);
      const after = res.body as Patient;
      expect(after).toMatchObject({
        fullName: 'Ayaan R. Chowdhury',
        dateOfBirth: '2021-05-02',
        // A date of birth replaces the approximate age.
        approximateAgeRecordedOn: null,
        age: { isApproximate: false },
        gender: null,
        referralOther: 'Pediatric clinic',
      });
      expect(after.therapyInterests.map((i) => i.code)).toEqual(['ABA', 'SLT']);
      // Contacts are untouched by profile edits.
      expect(after.contacts.map((c) => c.relationId)).toEqual(
        p.contacts.map((c) => c.relationId),
      );

      // Changing the source away from OTHER drops the custom text.
      const cleared = await admin.patch(`/patients/${p.id}`, {
        referralSource: 'WALK_IN',
      });
      expect(cleared.body).toMatchObject({
        referralSource: 'WALK_IN',
        referralOther: null,
      });

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'patient.updated', entityId: p.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit.metadata).toMatchObject({
        fields: expect.arrayContaining([
          'fullName',
          'dateOfBirth',
          'therapyTypeIds',
        ]),
      });
      expect(JSON.stringify(audit.metadata)).not.toContain('Chowdhury');

      const both = await admin.patch(`/patients/${p.id}`, {
        dateOfBirth: '2021-05-02',
        approximateAge: { years: 5 },
      });
      expect(both.status).toBe(400);
    });

    it('keeps a self-managing patient’s mobile while they’re their own contact', async () => {
      const { browser: admin } = await registerCenter(app);
      const p = await register(admin, {
        contact: { contactType: 'SELF', mobile: '01912345678' },
      });
      const res = await admin.patch(`/patients/${p.id}`, { mobile: '' });
      expect(res.status).toBe(400);
      expect(res.body.errors).toHaveProperty('mobile');
    });
  });

  describe('therapy interests', () => {
    it('uses the center’s own therapy types and keeps inactive ones already chosen', async () => {
      const { browser: admin } = await registerCenter(app);
      const { browser: other } = await registerCenter(app);
      const t = await types(admin);
      const foreign = await types(other);

      const cross = await admin.post('/patients', {
        fullName: 'Rafi',
        therapyTypeIds: [foreign.OT],
        contact: mother,
      });
      expect(cross.status).toBe(400);
      expect(cross.body.code).toBe('THERAPY_TYPE_NOT_FOUND');

      const p = await register(admin, { therapyTypeIds: [t.OT] });
      await admin.patch(`/therapy-types/${t.OT}/status`, { isActive: false });
      await admin.patch(`/therapy-types/${t.ABA}/status`, { isActive: false });

      const detail = (await admin.get(`/patients/${p.id}`)).body as Patient;
      expect(detail.therapyInterests).toEqual([
        expect.objectContaining({ code: 'OT', isActive: false }),
      ]);
      const kept = await admin.patch(`/patients/${p.id}`, {
        therapyTypeIds: [t.OT, t.SLT],
      });
      expect(kept.status).toBe(200);
      const added = await admin.patch(`/patients/${p.id}`, {
        therapyTypeIds: [t.OT, t.SLT, t.ABA],
      });
      expect(added.body.code).toBe('THERAPY_TYPE_INACTIVE');

      // A therapy type that patients are interested in can't be deleted.
      expect((await admin.delete(`/therapy-types/${t.OT}`)).status).toBe(409);
    });
  });

  describe('guardians', () => {
    it('finds guardians by mobile and links the same guardian to siblings', async () => {
      const { browser: admin } = await registerCenter(app);
      const first = await register(admin);
      const guardianId = first.contacts[0].guardianId;

      // A phone match is only shown, never merged automatically.
      const matches = (await admin.get('/guardians/search?q=+8801711-222'))
        .body as GuardianMatch[];
      expect(matches).toEqual([
        expect.objectContaining({
          id: guardianId,
          fullName: 'Nasrin Akter',
          patients: [
            expect.objectContaining({
              code: first.code,
              relationship: 'MOTHER',
            }),
          ],
        }),
      ]);
      expect(
        (
          (await admin.get('/guardians/search?q=nasrin'))
            .body as GuardianMatch[]
        ).length,
      ).toBe(1);

      const sibling = await register(admin, {
        fullName: 'Ayesha Rahman',
        contact: {
          contactType: 'GUARDIAN',
          guardianId,
          relationship: 'MOTHER',
          // Ignored for an existing guardian: details change through PATCH /guardians/:id.
          fullName: 'Someone Else',
          mobile: '01999999999',
        },
      });
      expect(sibling.contacts[0]).toMatchObject({
        guardianId,
        guardian: {
          fullName: 'Nasrin Akter',
          mobile: '01711222333',
          linkedPatientCount: 2,
        },
      });
      expect(await prisma.guardian.count()).toBe(1);

      // Typing the same number again on purpose creates a separate record.
      await register(admin, { fullName: 'Cousin' });
      expect(await prisma.guardian.count()).toBe(2);
    });

    it('manages several guardians per patient: link, relationship, primary and unlink', async () => {
      const { browser: admin } = await registerCenter(app);
      const p = await register(admin);
      const motherLink = p.contacts[0];

      const add = await admin.post(`/patients/${p.id}/guardians`, {
        contactType: 'GUARDIAN',
        fullName: 'Karim Rahman',
        mobile: '01811-444555',
        relationship: 'FATHER',
      });
      expect(add.status).toBe(201);
      const withFather = add.body as Patient;
      expect(withFather.contacts).toHaveLength(2);
      const fatherLink = withFather.contacts.find(
        (c) => c.relationship === 'FATHER',
      )!;
      expect(fatherLink.isPrimary).toBe(false);

      // An uncle here may be someone's father elsewhere: relationship is per patient.
      const caregiver = await admin.post(`/patients/${p.id}/guardians`, {
        contactType: 'CAREGIVER',
        fullName: 'Jamal Uddin',
        mobile: '01611-777888',
        relationship: 'OTHER',
        customRelationship: 'Uncle',
        isEmergencyContact: true,
      });
      const uncle = (caregiver.body as Patient).contacts.find(
        (c) => c.customRelationship === 'Uncle',
      )!;
      expect(uncle).toMatchObject({
        contactType: 'CAREGIVER',
        isEmergencyContact: true,
      });

      const dupe = await admin.post(`/patients/${p.id}/guardians`, {
        contactType: 'GUARDIAN',
        guardianId: fatherLink.guardianId,
        relationship: 'FATHER',
      });
      expect(dupe.status).toBe(409);
      expect(dupe.body.code).toBe('ALREADY_LINKED');

      const relabel = await admin.patch(
        `/patients/${p.id}/guardians/${uncle.relationId}`,
        { relationship: 'GRANDPARENT' },
      );
      expect(
        (relabel.body as Patient).contacts.find(
          (c) => c.relationId === uncle.relationId,
        ),
      ).toMatchObject({
        relationship: 'GRANDPARENT',
        customRelationship: null,
      });

      // The primary contact can't be removed until someone else is primary.
      const blocked = await admin.delete(
        `/patients/${p.id}/guardians/${motherLink.relationId}`,
      );
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('PRIMARY_CONTACT');

      const primary = await admin.put(`/patients/${p.id}/primary-contact`, {
        relationId: fatherLink.relationId,
      });
      const afterPrimary = primary.body as Patient;
      expect(afterPrimary.primaryContact).toMatchObject({
        name: 'Karim Rahman',
        relationship: 'FATHER',
      });
      expect(afterPrimary.contacts.filter((c) => c.isPrimary)).toHaveLength(1);

      const removed = await admin.delete(
        `/patients/${p.id}/guardians/${motherLink.relationId}`,
      );
      expect(removed.status).toBe(200);
      expect((removed.body as Patient).contacts).toHaveLength(2);
      // Only the relationship goes; the guardian stays on record.
      expect(
        await prisma.guardian.findUnique({
          where: { id: motherLink.guardianId },
        }),
      ).not.toBeNull();

      // Becoming their own contact needs the patient's own mobile first.
      const noMobile = await admin.put(`/patients/${p.id}/primary-contact`, {
        self: true,
      });
      expect(noMobile.status).toBe(400);
      await admin.patch(`/patients/${p.id}`, { mobile: '01511-000222' });
      const self = await admin.put(`/patients/${p.id}/primary-contact`, {
        self: true,
      });
      expect((self.body as Patient).primaryContact).toMatchObject({
        type: 'SELF',
      });
      expect((self.body as Patient).contacts.every((c) => !c.isPrimary)).toBe(
        true,
      );
    });

    it('edits a guardian’s shared details for all their patients', async () => {
      const { browser: admin } = await registerCenter(app);
      const a = await register(admin);
      const guardianId = a.contacts[0].guardianId;
      const b = await register(admin, {
        fullName: 'Ayesha',
        contact: {
          contactType: 'GUARDIAN',
          guardianId,
          relationship: 'MOTHER',
        },
      });
      const res = await admin.patch(`/guardians/${guardianId}`, {
        mobile: '01722-999000',
        email: 'nasrin@example.com',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        mobile: '01722999000',
        linkedPatientCount: 2,
      });
      const seen = (await admin.get(`/patients/${b.id}`)).body as Patient;
      expect(seen.primaryContact?.mobile).toBe('01722999000');
    });

    it('records consent from a linked contact and keeps the history', async () => {
      const { browser: admin } = await registerCenter(app);
      const p = await register(admin);
      const given = await admin.post(`/patients/${p.id}/consents`, {
        purpose: 'MEDIA',
        granted: true,
        givenBy: 'GUARDIAN',
        guardianId: p.contacts[0].guardianId,
      });
      expect(given.status).toBe(201);
      const withdrawn = await admin.post(`/patients/${p.id}/consents`, {
        purpose: 'MEDIA',
        granted: false,
        givenBy: 'GUARDIAN',
        guardianId: p.contacts[0].guardianId,
        note: 'Asked us to stop filming',
      });
      expect(
        (withdrawn.body as Patient).consents.map((c) => [c.purpose, c.granted]),
      ).toEqual([
        ['MEDIA', false],
        ['MEDIA', true],
      ]);
      const stranger = await admin.post(`/patients/${p.id}/consents`, {
        purpose: 'TREATMENT',
        granted: true,
        givenBy: 'GUARDIAN',
        guardianId: '00000000-0000-4000-8000-000000000000',
      });
      expect(stranger.status).toBe(400);
    });
  });

  describe('list, search and filters', () => {
    async function seed(admin: Browser) {
      const t = await types(admin);
      const ayaan = await register(admin, {
        fullName: 'Ayaan Rahman',
        gender: 'MALE',
        therapyTypeIds: [t.OT],
      });
      const zara = await register(admin, {
        fullName: 'Zara Ahmed',
        gender: 'FEMALE',
        therapyTypeIds: [t.SLT],
        status: 'ACTIVE',
        contact: {
          contactType: 'GUARDIAN',
          fullName: 'Tanvir Ahmed',
          mobile: '01855-123456',
          relationship: 'FATHER',
        },
      });
      const mina = await register(admin, {
        fullName: 'Mina Das',
        gender: 'FEMALE',
        therapyTypeIds: [t.OT, t.SLT],
        status: 'ACTIVE',
        contact: { contactType: 'SELF', mobile: '01933-987654' },
      });
      return { t, ayaan, zara, mina };
    }

    it('searches by patient, ID, guardian name, guardian mobile and own mobile', async () => {
      const { browser: admin } = await registerCenter(app);
      const { ayaan, zara, mina } = await seed(admin);
      const names = async (q: string) =>
        (await list(admin, `search=${encodeURIComponent(q)}`)).items.map(
          (p) => p.fullName,
        );
      expect(await names('zara')).toEqual(['Zara Ahmed']);
      expect(await names(ayaan.code)).toEqual(['Ayaan Rahman']);
      expect(await names('tanvir')).toEqual(['Zara Ahmed']);
      expect(await names('01855-123')).toEqual(['Zara Ahmed']);
      expect(await names('+8801933')).toEqual(['Mina Das']);
      expect(await names('nobody')).toEqual([]);

      const row = (await list(admin, 'search=zara')).items[0];
      expect(row).toMatchObject({
        id: zara.id,
        primaryContact: { name: 'Tanvir Ahmed', mobile: '01855123456' },
      });
      // Lists leave out notes, concerns and addresses.
      expect(row).not.toHaveProperty('internalNotes');
      expect(row).not.toHaveProperty('primaryConcern');
      expect(row).not.toHaveProperty('contacts');
      expect(mina.primaryContact?.type).toBe('SELF');
    });

    it('combines filters, paginates and sorts on the server', async () => {
      const { browser: admin } = await registerCenter(app);
      const { t } = await seed(admin);
      const names = (page: Page) => page.items.map((p) => p.fullName);

      expect(names(await list(admin, `therapyTypeId=${t.OT}`)).sort()).toEqual([
        'Ayaan Rahman',
        'Mina Das',
      ]);
      expect(
        names(
          await list(
            admin,
            `therapyTypeId=${t.SLT}&gender=FEMALE&status=ACTIVE&search=a`,
          ),
        ).sort(),
      ).toEqual(['Mina Das', 'Zara Ahmed']);
      const today = formatIsoDate(todayIn('Asia/Dhaka'));
      const tomorrow = formatIsoDate(addDays(todayIn('Asia/Dhaka'), 1));
      expect(
        (await list(admin, `registeredFrom=${today}&registeredTo=${today}`))
          .total,
      ).toBe(3);
      expect((await list(admin, `registeredFrom=${tomorrow}`)).total).toBe(0);

      // Newest first by default.
      expect(names(await list(admin))).toEqual([
        'Mina Das',
        'Zara Ahmed',
        'Ayaan Rahman',
      ]);
      expect(names(await list(admin, 'sortBy=fullName'))).toEqual([
        'Ayaan Rahman',
        'Mina Das',
        'Zara Ahmed',
      ]);
      expect(
        names(await list(admin, 'sortBy=fullName&sortOrder=desc')),
      ).toEqual(['Zara Ahmed', 'Mina Das', 'Ayaan Rahman']);

      const page2 = await list(admin, 'sortBy=fullName&pageSize=2&page=2');
      expect(page2).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(names(page2)).toEqual(['Zara Ahmed']);
      expect((await list(admin)).pageSize).toBe(20);
      expect((await admin.get('/patients?pageSize=500')).status).toBe(400);
      expect((await admin.get('/patients?sortBy=mobile')).status).toBe(400);
    });
  });

  describe('status and deletion', () => {
    it('activates and deactivates without touching contacts', async () => {
      const { browser: admin } = await registerCenter(app);
      const p = await register(admin);
      const active = await admin.patch(`/patients/${p.id}/status`, {
        status: 'ACTIVE',
      });
      expect(active.body.status).toBe('ACTIVE');
      const inactive = await admin.patch(`/patients/${p.id}/status`, {
        status: 'INACTIVE',
      });
      expect(inactive.body).toMatchObject({ status: 'INACTIVE' });
      expect((inactive.body as Patient).contacts).toHaveLength(1);
      expect(
        (await admin.patch(`/patients/${p.id}/status`, { status: 'NEW' }))
          .status,
      ).toBe(400);
      const actions = await prisma.auditLog.findMany({
        where: { entityId: p.id, action: { startsWith: 'patient.' } },
        select: { action: true },
      });
      expect(actions.map((a) => a.action)).toEqual(
        expect.arrayContaining(['patient.activated', 'patient.deactivated']),
      );
    });

    it('soft-deletes a patient and keeps their guardian and records', async () => {
      const { browser: admin } = await registerCenter(app);
      const p = await register(admin, { consents: [{ purpose: 'TREATMENT' }] });
      const sibling = await register(admin, {
        fullName: 'Sibling',
        contact: {
          contactType: 'GUARDIAN',
          guardianId: p.contacts[0].guardianId,
          relationship: 'MOTHER',
        },
      });
      expect((await admin.delete(`/patients/${p.id}`)).status).toBe(204);
      expect((await admin.get(`/patients/${p.id}`)).status).toBe(404);
      expect(
        (await admin.patch(`/patients/${p.id}`, { fullName: 'X' })).status,
      ).toBe(404);
      expect((await list(admin)).items.map((x) => x.id)).toEqual([sibling.id]);

      const row = await prisma.patient.findUniqueOrThrow({
        where: { id: p.id },
        include: { guardians: true, consents: true },
      });
      expect(row.deletedAt).not.toBeNull();
      expect(row.guardians).toHaveLength(1);
      expect(row.consents).toHaveLength(1);
      // The shared guardian stays, now counting only the remaining patient.
      const after = (await admin.get(`/patients/${sibling.id}`))
        .body as Patient;
      expect(after.contacts[0].guardian.linkedPatientCount).toBe(1);
      const matches = (await admin.get('/guardians/search?q=01711222333'))
        .body as GuardianMatch[];
      expect(matches[0].patients.map((x) => x.id)).toEqual([sibling.id]);
    });
  });

  describe('access control', () => {
    it('applies each role’s patient permissions', async () => {
      const { browser: admin } = await registerCenter(app);
      const p = await register(admin);
      const reception = await addStaff(app, admin, mail, {
        email: 'desk@example.com',
        role: 'RECEPTIONIST',
      });
      const manager = await addStaff(app, admin, mail, {
        email: 'manager@example.com',
        role: 'MANAGER',
      });
      const therapist = await addStaff(app, admin, mail, {
        email: 'therapist@example.com',
        role: 'THERAPIST',
      });

      // The front desk registers, edits, links contacts and changes status...
      const desk = reception.browser;
      const registered = await register(desk, { fullName: 'Walk-in' });
      expect(registered.registeredBy.fullName).toBe('Staff Member');
      expect(
        (
          await desk.patch(`/patients/${p.id}`, {
            primaryConcern: 'Fine motor',
          })
        ).status,
      ).toBe(200);
      expect(
        (await desk.patch(`/patients/${p.id}/status`, { status: 'ACTIVE' }))
          .status,
      ).toBe(200);
      expect((await desk.get('/guardians/search?q=nasrin')).status).toBe(200);
      // ...but only administrators delete patients.
      expect((await desk.delete(`/patients/${p.id}`)).status).toBe(403);
      expect((await manager.browser.delete(`/patients/${p.id}`)).status).toBe(
        403,
      );
      expect((await manager.browser.get(`/patients/${p.id}`)).status).toBe(200);

      // Therapists see no patients until patients can be assigned to them.
      const th = therapist.browser;
      expect((await th.get('/patients')).status).toBe(403);
      expect((await th.get(`/patients/${p.id}`)).status).toBe(403);
      expect((await th.get('/guardians/search?q=nasrin')).status).toBe(403);
      expect(
        (await th.post('/patients', { fullName: 'X', contact: mother })).status,
      ).toBe(403);

      const me = (await th.get('/auth/me')).body as {
        activeCenter: { permissions: string[] };
      };
      expect(
        me.activeCenter.permissions.some((x) => x.startsWith('patients.')),
      ).toBe(false);

      const anonymous = await new Browser(app).init();
      expect((await anonymous.get('/patients')).status).toBe(401);
    });
  });

  describe('center isolation', () => {
    it('keeps patients and guardians of other centers out of reach', async () => {
      const { browser: a } = await registerCenter(app);
      const { browser: b } = await registerCenter(app);
      const theirs = await register(b, { fullName: 'Other Center Child' });
      const theirGuardian = theirs.contacts[0].guardianId;
      const ours = await register(a);

      expect((await a.get(`/patients/${theirs.id}`)).status).toBe(404);
      expect(
        (await a.patch(`/patients/${theirs.id}`, { fullName: 'X' })).status,
      ).toBe(404);
      expect(
        (await a.patch(`/patients/${theirs.id}/status`, { status: 'INACTIVE' }))
          .status,
      ).toBe(404);
      expect((await a.delete(`/patients/${theirs.id}`)).status).toBe(404);
      expect(
        (
          await a.post(`/patients/${theirs.id}/guardians`, {
            contactType: 'GUARDIAN',
            fullName: 'X',
            mobile: '01700000000',
            relationship: 'FATHER',
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await a.delete(
            `/patients/${theirs.id}/guardians/${theirs.contacts[0].relationId}`,
          )
        ).status,
      ).toBe(404);
      // Another patient's relation ID doesn't work through ours either.
      expect(
        (
          await a.patch(
            `/patients/${ours.id}/guardians/${theirs.contacts[0].relationId}`,
            { isEmergencyContact: true },
          )
        ).status,
      ).toBe(404);

      // Same mobile in both centers: each sees only its own guardian.
      const search = (await a.get('/guardians/search?q=01711222333'))
        .body as GuardianMatch[];
      expect(search.map((g) => g.id)).toEqual([ours.contacts[0].guardianId]);
      expect(
        (await a.patch(`/guardians/${theirGuardian}`, { fullName: 'Hijacked' }))
          .status,
      ).toBe(404);

      // Another center's guardian can't be linked, at registration or afterwards.
      const crossRegister = await a.post('/patients', {
        fullName: 'Sneaky',
        contact: {
          contactType: 'GUARDIAN',
          guardianId: theirGuardian,
          relationship: 'MOTHER',
        },
      });
      expect(crossRegister.status).toBe(400);
      expect(crossRegister.body.errors).toHaveProperty(['contact.guardianId']);
      const crossLink = await a.post(`/patients/${ours.id}/guardians`, {
        contactType: 'GUARDIAN',
        guardianId: theirGuardian,
        relationship: 'MOTHER',
      });
      expect(crossLink.status).toBe(400);

      expect((await a.get('/patients')).body.total).toBe(1);
      const untouched = await prisma.guardian.findUniqueOrThrow({
        where: { id: theirGuardian },
      });
      expect(untouched.fullName).toBe('Nasrin Akter');
    });
  });
});
