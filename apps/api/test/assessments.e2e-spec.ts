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

interface Template {
  id: string;
  status: string;
  latestVersion: number;
  published: { id: string; version: number; definition: Definition } | null;
  draft: { id: string; version: number; definition: Definition } | null;
  actions: Record<string, boolean>;
}

interface Definition {
  sections: {
    key: string;
    title: string;
    fields: { key: string; type: string; label: string; required: boolean }[];
  }[];
}

interface Item {
  id: string;
  status: string;
  type: string;
  assessmentDate: string;
  revision: number;
  patient: { id: string };
  therapist: { id: string; isYou: boolean };
  template: { id: string; version: number; versionId: string };
  actions: Record<string, boolean>;
}

interface Detail extends Item {
  clinicalAccess: boolean;
  appointment: { id: string } | null;
  form: Definition | null;
  content: {
    answers: Record<string, unknown>;
    clinicalSummary: Record<string, string | null>;
    recommendations: {
      therapyType: { id: string };
      sessionsPerWeek: number | null;
      durationMinutes: number | null;
      reviewAfterWeeks: number | null;
    }[];
    goals: { title: string; priority: string | null }[];
  } | null;
  completedBy: { fullName: string } | null;
  amendments: { number: number; reason: string; changedFields: string[] }[];
}

const SAT = 6;
const MON = 1;
const OPEN_DAYS = [SAT, 0, MON, 2, 3, 4];

function week(days: number[]) {
  return {
    days: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      isAvailable: days.includes(dayOfWeek),
      intervals: [{ start: '09:00', end: '17:00' }],
    })),
  };
}

const today = () => formatIsoDate(todayIn('Asia/Dhaka'));

function nextWeekday(dayOfWeek: number) {
  let date = addDays(todayIn('Asia/Dhaka'), 7);
  while (date.getUTCDay() !== dayOfWeek) date = addDays(date, 1);
  return formatIsoDate(date);
}

const section = (key: string, fields: object[]) => ({
  key,
  title: key.toUpperCase(),
  fields,
});

describe('Assessments (e2e)', () => {
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
      assessmentId?: string;
    };
  }

  let counter = 0;

  async function therapist(
    admin: Browser,
    types: string[],
    membershipId?: string,
  ) {
    counter += 1;
    return ok<{ id: string; fullName: string }>(
      admin.post('/therapists', {
        fullName: `Therapist ${counter}`,
        mobile: `01711-0${String(counter).padStart(5, '0')}`,
        specializations: { therapyTypeIds: types },
        availability: week(OPEN_DAYS),
        ...(membershipId && { membershipId }),
      }),
      201,
    );
  }

  async function patient(admin: Browser, fullName: string) {
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
  }

  async function publishedTemplate(
    admin: Browser,
    therapyTypeId: string,
    name = 'General OT initial assessment',
  ) {
    const t = await ok<Template>(
      admin.post('/assessment-templates', {
        name,
        therapyTypeId,
        starter: true,
      }),
      201,
    );
    return ok<Template>(admin.post(`/assessment-templates/${t.id}/publish`));
  }

  /**
   * A center with a therapist who signs in (OT and ABA, with an assessment booked for
   * Ayaan), a colleague who signs in, one without an account, front desk, two
   * patients and a published starter template for OT.
   */
  async function setup() {
    const center = await registerCenter(app);
    const admin = center.browser;
    const list = (await admin.get('/therapy-types')).body as {
      id: string;
      code: string;
    }[];
    const t = Object.fromEntries(list.map((x) => [x.code, x.id]));
    const staffA = await addStaff(app, admin, mail, {
      email: `a${counter}@example.com`,
      role: 'THERAPIST',
      fullName: 'Farhana Akter',
    });
    const staffB = await addStaff(app, admin, mail, {
      email: `b${counter}@example.com`,
      role: 'THERAPIST',
      fullName: 'Rafiq Hasan',
    });
    const desk = await addStaff(app, admin, mail, {
      email: `desk${counter}@example.com`,
      role: 'RECEPTIONIST',
    });
    const a = await therapist(admin, [t.OT, t.ABA], staffA.membershipId);
    const b = await therapist(admin, [t.OT], staffB.membershipId);
    const noAccount = await therapist(admin, [t.OT]);
    const ayaan = await patient(admin, 'Ayaan Rahman');
    const other = await patient(admin, 'Zara Karim');
    const appointment = await ok<{ id: string }>(
      admin.post('/appointments', {
        patientId: ayaan.id,
        type: 'ASSESSMENT',
        therapyTypeId: t.OT,
        therapistId: a.id,
        durationMinutes: 60,
        date: nextWeekday(MON),
        startTime: '10:00',
      }),
      201,
    );
    const template = await publishedTemplate(admin, t.OT);
    return {
      ...center,
      admin,
      t,
      staffA: staffA.browser,
      staffB: staffB.browser,
      desk: desk.browser,
      a,
      b,
      noAccount,
      ayaan,
      other,
      appointment,
      template,
    };
  }
  type Setup = Awaited<ReturnType<typeof setup>>;

  function draftFor(s: Setup, overrides: Record<string, unknown> = {}) {
    return {
      patientId: s.ayaan.id,
      therapyTypeId: s.t.OT,
      type: 'INITIAL',
      templateId: s.template.id,
      therapistId: s.a.id,
      assessmentDate: today(),
      ...overrides,
    };
  }

  const finished = {
    answers: {
      chief_concern: 'Difficulty holding a pencil',
      domains_assessed: ['motor', 'sensory'],
      functional_ability: 'moderate_assistance',
    },
    clinicalSummary: {
      summary: 'Fine motor delays affecting school tasks.',
      strengths: 'Motivated, follows two-step instructions',
    },
  };

  describe('templates', () => {
    it('builds, publishes and versions a template without changing published forms', async () => {
      const s = await setup();
      const draft = await ok<Template>(
        s.admin.post('/assessment-templates', {
          name: 'Speech & language assessment',
          therapyTypeId: s.t.SLT,
        }),
        201,
      );
      expect(draft).toMatchObject({ status: 'DRAFT', draft: { version: 1 } });
      expect(draft.draft!.definition).toEqual({ sections: [] });

      // Sections and every field type can be added; sections can be removed again.
      const allTypes = [
        { key: 'concern', type: 'TEXTAREA', label: 'Concern', required: true },
        { key: 'referred_by', type: 'TEXT', label: 'Referred by' },
        { key: 'mlu', type: 'NUMBER', label: 'Mean length of utterance' },
        {
          key: 'speech',
          type: 'SINGLE_SELECT',
          label: 'Intelligibility',
          options: [
            { value: 'good', label: 'Good' },
            { value: 'poor', label: 'Poor' },
          ],
        },
        {
          key: 'areas',
          type: 'MULTI_SELECT',
          label: 'Areas',
          options: [
            { value: 'receptive', label: 'Receptive language' },
            { value: 'expressive', label: 'Expressive language' },
          ],
        },
        {
          key: 'eye_contact',
          type: 'RADIO',
          label: 'Eye contact',
          options: [
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
            { value: 'sometimes', label: 'Sometimes' },
          ],
        },
        {
          key: 'guardian_present',
          type: 'CHECKBOX',
          label: 'Guardian present',
        },
        { key: 'hearing_test', type: 'DATE', label: 'Last hearing test' },
      ];
      let saved = await ok<Template>(
        s.admin.patch(`/assessment-templates/${draft.id}`, {
          definition: {
            sections: [section('general', allTypes), section('extra', [])],
          },
        }),
      );
      expect(saved.draft!.definition.sections).toHaveLength(2);
      saved = await ok<Template>(
        s.admin.patch(`/assessment-templates/${draft.id}`, {
          definition: { sections: [section('general', allTypes)] },
        }),
      );
      expect(saved.draft!.definition.sections.map((x) => x.key)).toEqual([
        'general',
      ]);

      // Unsupported field types and broken options are refused.
      const bad = await fails(
        s.admin.patch(`/assessment-templates/${draft.id}`, {
          definition: {
            sections: [
              section('general', [
                { key: 'sig', type: 'SIGNATURE', label: 'Signature' },
                {
                  key: 'pick',
                  type: 'RADIO',
                  label: 'Pick',
                  options: [{ value: 'a', label: 'A' }],
                },
              ]),
            ],
          },
        }),
        400,
      );
      expect(bad.errors).toMatchObject({
        'definition.sections.0.fields.0.type': 'Choose a supported field type',
        'definition.sections.0.fields.1.options': 'Add at least 2 options',
      });

      const v1 = await ok<Template>(
        s.admin.post(`/assessment-templates/${draft.id}/publish`),
      );
      expect(v1).toMatchObject({
        status: 'PUBLISHED',
        draft: null,
        published: { version: 1 },
      });

      // A published version is frozen…
      const frozen = await fails(
        s.admin.patch(`/assessment-templates/${draft.id}`, {
          definition: { sections: [] },
        }),
        409,
      );
      expect(frozen.code).toBe('TEMPLATE_VERSION_PUBLISHED');
      // …by the database too, whatever the API does.
      await expect(
        prisma.assessmentTemplateVersion.update({
          where: { id: v1.published!.id },
          data: { definition: { sections: [] } },
        }),
      ).rejects.toThrow();

      // A new version starts as a copy of the published one.
      const v2draft = await ok<Template>(
        s.admin.post(`/assessment-templates/${draft.id}/versions`),
        201,
      );
      expect(v2draft.draft).toMatchObject({ version: 2 });
      expect(v2draft.draft!.definition).toEqual(v1.published!.definition);

      // A kept field can't change type between versions.
      const changed = structuredClone(v2draft.draft!.definition);
      changed.sections[0].fields[2].type = 'TEXT';
      await ok(
        s.admin.patch(`/assessment-templates/${draft.id}`, {
          definition: changed,
        }),
      );
      const typeError = await fails(
        s.admin.post(`/assessment-templates/${draft.id}/publish`),
        400,
      );
      expect(Object.keys(typeError.errors!)).toEqual([
        'definition.sections.0.fields.2.type',
      ]);

      const renamed = structuredClone(v1.published!.definition);
      renamed.sections[0].fields[0].label = 'Main concern';
      renamed.sections[0].fields.splice(1, 1);
      await ok(
        s.admin.patch(`/assessment-templates/${draft.id}`, {
          definition: renamed,
        }),
      );
      const v2 = await ok<Template>(
        s.admin.post(`/assessment-templates/${draft.id}/publish`),
      );
      expect(v2.published).toMatchObject({ version: 2 });

      // Version 1 is still readable exactly as it was.
      const versions = await ok<
        { id: string; version: number; status: string }[]
      >(s.admin.get(`/assessment-templates/${draft.id}/versions`));
      expect(versions.map((v) => [v.version, v.status])).toEqual([
        [2, 'PUBLISHED'],
        [1, 'SUPERSEDED'],
      ]);
      const old = await ok<{ definition: Definition }>(
        s.admin.get(
          `/assessment-templates/${draft.id}/versions/${v1.published!.id}`,
        ),
      );
      expect(old.definition).toEqual(v1.published!.definition);
    });

    it('keeps template management with administrators', async () => {
      const s = await setup();
      // Therapists read templates to choose one, but can't change them.
      await ok(s.staffA.get('/assessment-templates'));
      await fails(
        s.staffA.post('/assessment-templates', {
          name: 'X',
          therapyTypeId: s.t.OT,
        }),
        403,
      );
      await fails(
        s.staffA.post(`/assessment-templates/${s.template.id}/archive`),
        403,
      );
      // Front desk doesn't need forms at all.
      await fails(s.desk.get('/assessment-templates'), 403);
    });

    it('archives templates so they can’t start new assessments', async () => {
      const s = await setup();
      await ok(s.admin.post(`/assessment-templates/${s.template.id}/archive`));
      const res = await fails(s.staffA.post('/assessments', draftFor(s)), 400);
      expect(res.code).toBe('TEMPLATE_ARCHIVED');
      await ok(s.admin.post(`/assessment-templates/${s.template.id}/restore`));
      await ok(s.staffA.post('/assessments', draftFor(s)), 201);
    });
  });

  describe('assessment lifecycle', () => {
    it('drafts, completes and amends an assessment, keeping every version', async () => {
      const s = await setup();
      const created = await ok<Detail>(
        s.staffA.post(
          '/assessments',
          draftFor(s, { appointmentId: s.appointment.id }),
        ),
        201,
      );
      expect(created).toMatchObject({
        status: 'DRAFT',
        revision: 1,
        clinicalAccess: true,
        appointment: { id: s.appointment.id },
        therapist: { id: s.a.id, isYou: true },
        template: { version: 1 },
        actions: { edit: true, complete: true, amend: false, discard: true },
      });

      // An incomplete draft saves fine.
      const draft = await ok<Detail>(
        s.staffA.patch(`/assessments/${created.id}`, {
          revision: 1,
          answers: { observations: 'Avoids messy play' },
        }),
      );
      expect(draft.revision).toBe(2);
      expect(draft.content!.answers).toEqual({
        observations: 'Avoids messy play',
      });

      // Unknown questions and wrong kinds of answer never get stored.
      const unknown = await fails(
        s.staffA.patch(`/assessments/${created.id}`, {
          revision: 2,
          answers: { diagnosis: 'ASD', functional_ability: 'excellent' },
        }),
        400,
      );
      expect(unknown.errors).toEqual({
        'answers.diagnosis': 'This question isn’t part of the form',
        'answers.functional_ability': 'Choose one of the options',
      });
      const wrongType = await fails(
        s.staffA.patch(`/assessments/${created.id}`, {
          revision: 2,
          answers: { domains_assessed: 'motor' },
        }),
        400,
      );
      expect(wrongType.errors).toHaveProperty(['answers.domains_assessed']);

      // A stale revision is refused rather than overwriting newer work.
      expect(
        (
          await fails(
            s.staffA.patch(`/assessments/${created.id}`, { revision: 1 }),
            409,
          )
        ).code,
      ).toBe('ASSESSMENT_CHANGED');

      // Completing needs the required questions and a summary.
      const incomplete = await fails(
        s.staffA.post(`/assessments/${created.id}/complete`, { revision: 2 }),
        400,
      );
      expect(incomplete.errors).toEqual({
        'answers.chief_concern': 'Chief concern is required',
        'clinicalSummary.summary':
          'Write an assessment summary to complete the assessment',
      });

      const completed = await ok<Detail>(
        s.staffA.post(`/assessments/${created.id}/complete`, {
          revision: 2,
          ...finished,
          recommendations: [
            {
              therapyTypeId: s.t.OT,
              sessionsPerWeek: 3,
              durationMinutes: 45,
              reviewAfterWeeks: 8,
            },
          ],
          goals: [
            { title: 'Hold a pencil with a tripod grasp', priority: 'HIGH' },
            { title: 'Dress independently' },
          ],
        }),
      );
      expect(completed).toMatchObject({
        status: 'COMPLETED',
        completedBy: { fullName: 'Farhana Akter' },
        actions: { edit: false, complete: false, amend: true, discard: false },
      });
      expect(completed.content!.recommendations).toEqual([
        expect.objectContaining({
          therapyType: expect.objectContaining({ id: s.t.OT }),
          sessionsPerWeek: 3,
          durationMinutes: 45,
          reviewAfterWeeks: 8,
        }),
      ]);
      expect(completed.content!.goals.map((g) => g.title)).toEqual([
        'Hold a pencil with a tripod grasp',
        'Dress independently',
      ]);

      // Completing doesn't book, attend or bill anything.
      const appt = await ok<{ status: string; assessment: { id: string } }>(
        s.admin.get(`/appointments/${s.appointment.id}`),
      );
      expect(appt).toMatchObject({
        status: 'SCHEDULED',
        assessment: { id: created.id },
      });

      // Signed content can't be edited or deleted, only amended.
      expect(
        (
          await fails(
            s.staffA.patch(`/assessments/${created.id}`, {
              revision: completed.revision,
            }),
            409,
          )
        ).code,
      ).toBe('ASSESSMENT_COMPLETED');
      await fails(s.staffA.delete(`/assessments/${created.id}`), 409);
      await expect(
        prisma.assessment.delete({ where: { id: created.id } }),
      ).rejects.toThrow();

      const noReason = await fails(
        s.staffA.post(`/assessments/${created.id}/amend`, {
          revision: completed.revision,
          reason: '',
        }),
        400,
      );
      expect(noReason.errors).toHaveProperty('reason');

      const amended = await ok<Detail>(
        s.staffA.post(`/assessments/${created.id}/amend`, {
          revision: completed.revision,
          reason: 'Recorded the wrong ability level',
          answers: {
            ...finished.answers,
            functional_ability: 'minimal_assistance',
          },
        }),
      );
      expect(amended.status).toBe('AMENDED');
      expect(amended.content!.answers.functional_ability).toBe(
        'minimal_assistance',
      );
      expect(amended.amendments).toEqual([
        expect.objectContaining({
          number: 1,
          reason: 'Recorded the wrong ability level',
          changedFields: ['Overall functional ability'],
        }),
      ]);

      // The signed original is kept.
      const original = await ok<{
        previousContent: { answers: Record<string, unknown>; goals: unknown[] };
        amendedBy: { fullName: string };
      }>(s.staffA.get(`/assessments/${created.id}/amendments/1`));
      expect(original.previousContent.answers.functional_ability).toBe(
        'moderate_assistance',
      );
      expect(original.previousContent.goals).toHaveLength(2);
      expect(original.amendedBy.fullName).toBe('Farhana Akter');
      await expect(
        prisma.assessmentAmendment.deleteMany({
          where: { assessmentId: created.id },
        }),
      ).rejects.toThrow();

      // Nothing clinical reaches the audit log.
      const audit = await prisma.auditLog.findMany({
        where: { entityId: created.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit.map((a) => a.action)).toEqual([
        'assessment.created',
        'assessment.completed',
        'assessment.amended',
      ]);
      expect(JSON.stringify(audit)).not.toMatch(
        /pencil|ability level|motor delays/i,
      );
    });

    it('links one assessment per appointment', async () => {
      const s = await setup();
      const first = await ok<Detail>(
        s.staffA.post(
          '/assessments',
          draftFor(s, { appointmentId: s.appointment.id }),
        ),
        201,
      );
      const dupe = await fails(
        s.staffA.post(
          '/assessments',
          draftFor(s, { appointmentId: s.appointment.id }),
        ),
        409,
      );
      expect(dupe).toMatchObject({
        code: 'APPOINTMENT_ALREADY_ASSESSED',
        assessmentId: first.id,
      });
      // Discarding the draft frees the appointment.
      await ok(s.staffA.delete(`/assessments/${first.id}`), 204);
      await ok(
        s.staffA.post(
          '/assessments',
          draftFor(s, { appointmentId: s.appointment.id }),
        ),
        201,
      );
      // Only assessment bookings of the same patient, therapist and therapy fit.
      const session = await ok<{ id: string }>(
        s.admin.post('/appointments', {
          patientId: s.ayaan.id,
          type: 'THERAPY_SESSION',
          therapyTypeId: s.t.OT,
          therapistId: s.a.id,
          durationMinutes: 45,
          date: nextWeekday(MON),
          startTime: '14:00',
        }),
        201,
      );
      expect(
        (
          await fails(
            s.staffA.post(
              '/assessments',
              draftFor(s, { appointmentId: session.id }),
            ),
            400,
          )
        ).code,
      ).toBe('NOT_AN_ASSESSMENT_APPOINTMENT');
    });

    it('starts from the template version in use and keeps it', async () => {
      const s = await setup();
      const a = await ok<Detail>(
        s.staffA.post('/assessments', draftFor(s)),
        201,
      );
      await ok(
        s.staffA.post(`/assessments/${a.id}/complete`, {
          revision: a.revision,
          ...finished,
        }),
      );
      // The template moves on: a renamed question, one removed.
      const t = await ok<Template>(
        s.admin.post(`/assessment-templates/${s.template.id}/versions`),
        201,
      );
      const next = structuredClone(t.draft!.definition);
      next.sections[0].fields[0].label = 'Main concern';
      next.sections[1].fields = next.sections[1].fields.filter(
        (f) => f.key !== 'functional_ability',
      );
      await ok(
        s.admin.patch(`/assessment-templates/${s.template.id}`, {
          definition: next,
        }),
      );
      await ok(s.admin.post(`/assessment-templates/${s.template.id}/publish`));

      const old = await ok<Detail>(s.staffA.get(`/assessments/${a.id}`));
      expect(old.template.version).toBe(1);
      expect(old.form!.sections[0].fields[0].label).toBe('Chief concern');
      expect(old.content!.answers).toEqual(finished.answers);

      const fresh = await ok<Detail>(
        s.staffA.post('/assessments', draftFor(s)),
        201,
      );
      expect(fresh.template.version).toBe(2);
      // An answer to the removed question doesn't fit the new form.
      await fails(
        s.staffA.patch(`/assessments/${fresh.id}`, {
          revision: fresh.revision,
          answers: { functional_ability: 'independent' },
        }),
        400,
      );
    });
  });

  describe('who may assess whom', () => {
    it('checks therapist, patient and template eligibility', async () => {
      const s = await setup();
      // Therapists only ever assess as themselves…
      expect(
        (
          await fails(
            s.staffA.post('/assessments', draftFor(s, { therapistId: s.b.id })),
            400,
          )
        ).code,
      ).toBe('THERAPIST_NOT_FOUND');
      // …and only patients in their care.
      expect(
        (
          await fails(
            s.staffA.post(
              '/assessments',
              draftFor(s, { patientId: s.other.id }),
            ),
            400,
          )
        ).code,
      ).toBe('PATIENT_NOT_FOUND');
      const options = await ok<{ items: { id: string }[] }>(
        s.staffA.get('/assessments/patient-options'),
      );
      expect(options.items.map((p) => p.id)).toEqual([s.ayaan.id]);

      // Assessments are signed by their therapist, so one without an account can't have one.
      expect(
        (
          await fails(
            s.admin.post(
              '/assessments',
              draftFor(s, { therapistId: s.noAccount.id }),
            ),
            400,
          )
        ).code,
      ).toBe('THERAPIST_NO_ACCOUNT');
      // The therapist must provide the therapy, and the template must be for it.
      expect(
        (
          await fails(
            s.admin.post(
              '/assessments',
              draftFor(s, { therapistId: s.b.id, therapyTypeId: s.t.ABA }),
            ),
            400,
          )
        ).code,
      ).toBe('TEMPLATE_THERAPY_MISMATCH');
      const aba = await publishedTemplate(s.admin, s.t.ABA, 'ABA intake');
      expect(
        (
          await fails(
            s.admin.post(
              '/assessments',
              draftFor(s, {
                therapistId: s.b.id,
                therapyTypeId: s.t.ABA,
                templateId: aba.id,
              }),
            ),
            400,
          )
        ).code,
      ).toBe('THERAPIST_NOT_SPECIALIZED');

      // Administrators may set an assessment up for a colleague, who then writes it.
      const forB = await ok<Detail>(
        s.admin.post(
          '/assessments',
          draftFor(s, { therapistId: s.b.id, patientId: s.other.id }),
        ),
        201,
      );
      const refused = await fails(
        s.admin.patch(`/assessments/${forB.id}`, { revision: 1, ...finished }),
        403,
      );
      expect(refused.code).toBe('NOT_RESPONSIBLE_THERAPIST');
      await ok(
        s.staffB.patch(`/assessments/${forB.id}`, { revision: 1, ...finished }),
      );
    });

    it('limits clinical content to the people who should see it', async () => {
      const s = await setup();
      const a = await ok<Detail>(
        s.staffA.post('/assessments', draftFor(s)),
        201,
      );

      // A colleague can't see another therapist's draft at all.
      await fails(s.staffB.get(`/assessments/${a.id}`), 404);
      expect(
        (await ok<{ total: number }>(s.staffB.get('/assessments'))).total,
      ).toBe(0);

      // Front desk sees that it exists and its status, never its content.
      const deskView = await ok<Detail>(s.desk.get(`/assessments/${a.id}`));
      expect(deskView).toMatchObject({
        status: 'DRAFT',
        clinicalAccess: false,
        content: null,
        form: null,
        actions: { view: false, edit: false },
      });
      const deskList = await ok<{ items: Item[] }>(s.desk.get('/assessments'));
      expect(deskList.items.map((i) => i.id)).toEqual([a.id]);
      expect(deskList.items[0]).not.toHaveProperty('content');
      await fails(
        s.desk.patch(`/assessments/${a.id}`, { revision: 1, ...finished }),
        403,
      );
      await fails(s.desk.post('/assessments', draftFor(s)), 403);

      await ok(
        s.staffA.post(`/assessments/${a.id}/complete`, {
          revision: 1,
          ...finished,
        }),
      );

      // Administrators read completed work (e.g. to print it) but can't change it.
      const adminView = await ok<Detail>(s.admin.get(`/assessments/${a.id}`));
      expect(adminView.content!.answers).toEqual(finished.answers);
      expect(adminView.actions).toMatchObject({ view: true, amend: false });
      await fails(
        s.admin.post(`/assessments/${a.id}/amend`, {
          revision: 2,
          reason: 'Fixing it',
          ...finished,
        }),
        403,
      );

      // A colleague who also sees Ayaan can read the completed assessment.
      await fails(s.staffB.get(`/assessments/${a.id}`), 404);
      await ok(
        s.admin.post('/appointments', {
          patientId: s.ayaan.id,
          type: 'THERAPY_SESSION',
          therapyTypeId: s.t.OT,
          therapistId: s.b.id,
          durationMinutes: 45,
          date: nextWeekday(MON),
          startTime: '15:00',
        }),
        201,
      );
      const colleague = await ok<Detail>(s.staffB.get(`/assessments/${a.id}`));
      expect(colleague).toMatchObject({
        clinicalAccess: true,
        actions: { amend: false },
      });
      await fails(
        s.staffB.post(`/assessments/${a.id}/amend`, {
          revision: 2,
          reason: 'Not mine',
          ...finished,
        }),
        403,
      );
    });

    it('keeps centers apart', async () => {
      const s = await setup();
      const a = await ok<Detail>(
        s.staffA.post('/assessments', draftFor(s)),
        201,
      );
      const other = await registerCenter(app);
      const otherTypes = (await other.browser.get('/therapy-types')).body as {
        id: string;
        code: string;
      }[];
      const otherOt = otherTypes.find((x) => x.code === 'OT')!.id;
      const foreignTemplate = await publishedTemplate(other.browser, otherOt);
      const foreignPatient = await patient(other.browser, 'Other Patient');

      await fails(other.browser.get(`/assessments/${a.id}`), 404);
      await fails(
        other.browser.get(`/assessment-templates/${s.template.id}`),
        404,
      );
      await fails(
        other.browser.get(`/patients/${s.ayaan.id}/assessments`),
        404,
      );
      expect(
        (await ok<{ total: number }>(other.browser.get('/assessments'))).total,
      ).toBe(0);

      // Another center's template, patient, therapist or appointment can't be used.
      const crossTemplate = await fails(
        s.staffA.post(
          '/assessments',
          draftFor(s, { templateId: foreignTemplate.id }),
        ),
        400,
      );
      expect(crossTemplate.code).toBe('TEMPLATE_NOT_FOUND');
      expect(
        (
          await fails(
            s.admin.post(
              '/assessments',
              draftFor(s, { patientId: foreignPatient.id }),
            ),
            400,
          )
        ).code,
      ).toBe('PATIENT_NOT_FOUND');
      expect(
        (
          await fails(
            other.browser.post('/assessments', {
              ...draftFor(s),
              therapyTypeId: otherOt,
              templateId: foreignTemplate.id,
              patientId: foreignPatient.id,
            }),
            400,
          )
        ).code,
      ).toBe('THERAPIST_NOT_FOUND');
      await fails(
        s.staffA.patch(`/assessments/${a.id}`, {
          revision: 1,
          recommendations: [{ therapyTypeId: otherOt }],
        }),
        400,
      );
    });
  });

  describe('history', () => {
    it('filters assessments and lists a patient’s history newest first', async () => {
      const s = await setup();
      const first = await ok<Detail>(
        s.staffA.post(
          '/assessments',
          draftFor(s, {
            assessmentDate: formatIsoDate(addDays(todayIn('Asia/Dhaka'), -30)),
          }),
        ),
        201,
      );
      await ok(
        s.staffA.post(`/assessments/${first.id}/complete`, {
          revision: 1,
          ...finished,
        }),
      );
      const followUp = await ok<Detail>(
        s.staffA.post('/assessments', draftFor(s, { type: 'FOLLOW_UP' })),
        201,
      );
      const otherTemplate = await publishedTemplate(
        s.admin,
        s.t.ABA,
        'ABA intake',
      );
      const aba = await ok<Detail>(
        s.staffA.post(
          '/assessments',
          draftFor(s, { therapyTypeId: s.t.ABA, templateId: otherTemplate.id }),
        ),
        201,
      );

      const ids = async (q: string) =>
        (
          await ok<{ items: Item[] }>(s.admin.get(`/assessments?${q}`))
        ).items.map((i) => i.id);
      expect(await ids('status=COMPLETED')).toEqual([first.id]);
      expect(await ids('status=DRAFT&type=FOLLOW_UP')).toEqual([followUp.id]);
      expect(await ids(`therapyTypeId=${s.t.ABA}`)).toEqual([aba.id]);
      expect(await ids(`therapistId=${s.b.id}`)).toEqual([]);
      expect(await ids(`from=${today()}&to=${today()}`)).toHaveLength(2);
      expect(await ids('search=ayaan')).toHaveLength(3);
      expect(await ids(`patientId=${s.other.id}`)).toEqual([]);

      const history = await ok<{ items: Item[] }>(
        s.desk.get(`/patients/${s.ayaan.id}/assessments`),
      );
      expect(history.items.map((i) => i.id).slice(-1)).toEqual([first.id]);
      expect(history.items).toHaveLength(3);
      // Therapists don't see patients outside their care.
      await fails(s.staffA.get(`/patients/${s.other.id}/assessments`), 404);
    });
  });
});
