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

interface Goal {
  id: string;
  title: string;
  status: string;
  measurementType: string;
  measurementConfig: Record<string, unknown> | null;
  baseline: { value: number | null; text: string | null };
  target: { value: number | null; text: string | null };
  category: { id: string; name: string } | null;
  sourceAssessmentGoalId: string | null;
  latestProgress: {
    measuredValue: number | null;
    observation: string | null;
  } | null;
  progressCount: number;
}

interface Plan {
  id: string;
  code: string;
  title: string;
  status: string;
  revision: number;
  clinicalAccess: boolean;
  therapist: { id: string; isYou: boolean };
  frequency: {
    sessionsPerPeriod: number | null;
    unit: string | null;
    label: string | null;
  };
  nextReviewDate: string | null;
  reviewState: string | null;
  sourceAssessment: { id: string } | null;
  sourceAssessmentId: string | null;
  goalSummary: Record<string, number> | null;
  goals: Goal[];
  reviews: { id: string; number: number }[];
  history: {
    number: number;
    event: string;
    changedFields: string[];
    previousSnapshot: Record<string, unknown> | null;
    newSnapshot: Record<string, unknown> | null;
    reason: string | null;
    revisedBy: { fullName: string };
  }[];
  statusReason: string | null;
  completionSummary: string | null;
  actions: Record<string, boolean>;
}

interface Progress {
  id: string;
  observationDate: string;
  measuredValue: number | null;
  observation: string | null;
  goalStatus: string | null;
  isCorrected: boolean;
  correctsId: string | null;
  recordedBy: { fullName: string };
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

const dhakaToday = () => todayIn('Asia/Dhaka');
const today = () => formatIsoDate(dhakaToday());
const daysFromToday = (n: number) => formatIsoDate(addDays(dhakaToday(), n));

function nextMonday() {
  let date = addDays(dhakaToday(), 7);
  while (date.getUTCDay() !== MON) date = addDays(date, 1);
  return formatIsoDate(date);
}

const finished = {
  answers: {
    chief_concern: 'Difficulty holding a pencil',
    domains_assessed: ['motor', 'sensory'],
    functional_ability: 'moderate_assistance',
  },
  clinicalSummary: { summary: 'Fine motor delays affecting school tasks.' },
};

describe('Therapy plans (e2e)', () => {
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
      planId?: string;
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

  /**
   * A center with two therapists who sign in (A: OT and ABA; B: OT only), one without an
   * account, front desk, a manager, two patients, and a completed OT assessment of
   * Ayaan by A that recommends OT and SLT and suggests two goals.
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
    const manager = await addStaff(app, admin, mail, {
      email: `manager${counter}@example.com`,
      role: 'MANAGER',
    });
    const a = await therapist(admin, [t.OT, t.ABA], staffA.membershipId);
    const b = await therapist(admin, [t.OT], staffB.membershipId);
    const noAccount = await therapist(admin, [t.OT]);
    const ayaan = await patient(admin, 'Ayaan Rahman');
    const other = await patient(admin, 'Zara Karim');

    // A has bookings with both patients, so both are in A's care.
    for (const [p, startTime] of [
      [ayaan, '10:00'],
      [other, '11:00'],
    ] as const) {
      await ok(
        admin.post('/appointments', {
          patientId: p.id,
          type: 'ASSESSMENT',
          therapyTypeId: t.OT,
          therapistId: a.id,
          durationMinutes: 60,
          date: nextMonday(),
          startTime,
        }),
        201,
      );
    }
    const template = await ok<{ id: string }>(
      admin.post('/assessment-templates', {
        name: 'General OT initial assessment',
        therapyTypeId: t.OT,
        starter: true,
      }),
      201,
    );
    await ok(admin.post(`/assessment-templates/${template.id}/publish`));
    const draft = await ok<{ id: string; revision: number }>(
      staffA.browser.post('/assessments', {
        patientId: ayaan.id,
        therapyTypeId: t.OT,
        type: 'INITIAL',
        templateId: template.id,
        therapistId: a.id,
        assessmentDate: today(),
      }),
      201,
    );
    await ok(
      staffA.browser.post(`/assessments/${draft.id}/complete`, {
        revision: draft.revision,
        ...finished,
        recommendations: [
          {
            therapyTypeId: t.OT,
            sessionsPerWeek: 3,
            durationMinutes: 45,
            reviewAfterWeeks: 8,
          },
          { therapyTypeId: t.SLT, sessionsPerWeek: 2, durationMinutes: 30 },
        ],
        goals: [
          { title: 'Hold a pencil with a tripod grasp', priority: 'HIGH' },
          { title: 'Dress independently' },
        ],
      }),
    );
    return {
      ...center,
      admin,
      t,
      staffA: staffA.browser,
      staffB: staffB.browser,
      desk: desk.browser,
      manager: manager.browser,
      a,
      b,
      noAccount,
      ayaan,
      other,
      template,
      assessmentId: draft.id,
    };
  }
  type Setup = Awaited<ReturnType<typeof setup>>;

  const narrativeGoal = {
    title: 'Improve fine motor coordination',
    description: 'Manipulate small objects during age-appropriate activities.',
    priority: 'HIGH',
    baselineText: 'Needs significant assistance',
    targetText: 'Minimal assistance in 4 of 5 opportunities',
  };

  const percentGoal = {
    title: 'Follow two-step instructions',
    measurementType: 'PERCENTAGE',
    baselineValue: 30,
    targetValue: 80,
  };

  function planFor(s: Setup, overrides: Record<string, unknown> = {}) {
    return {
      patientId: s.ayaan.id,
      therapyTypeId: s.t.OT,
      therapistId: s.a.id,
      title: 'OT treatment plan',
      startDate: today(),
      sessionsPerPeriod: 3,
      frequencyUnit: 'WEEK',
      durationMinutes: 45,
      reviewIntervalValue: 8,
      reviewIntervalUnit: 'WEEK',
      nextReviewDate: daysFromToday(56),
      goals: [narrativeGoal, percentGoal],
      ...overrides,
    };
  }

  async function activePlan(s: Setup, overrides: Record<string, unknown> = {}) {
    const draft = await ok<Plan>(
      s.staffA.post('/therapy-plans', planFor(s, overrides)),
      201,
    );
    return ok<Plan>(
      s.staffA.post(`/therapy-plans/${draft.id}/activate`, {
        revision: draft.revision,
      }),
    );
  }

  describe('creating plans', () => {
    it('saves a draft with goals, and needs frequency and a goal to activate', async () => {
      const s = await setup();
      // A draft needs only who, what, a title and a start date.
      const bare = await ok<Plan>(
        s.staffA.post('/therapy-plans', {
          patientId: s.ayaan.id,
          therapyTypeId: s.t.OT,
          therapistId: s.a.id,
          title: 'OT plan',
          startDate: today(),
        }),
        201,
      );
      expect(bare).toMatchObject({
        code: 'TP-0001',
        status: 'DRAFT',
        clinicalAccess: true,
        therapist: { id: s.a.id, isYou: true },
        goals: [],
        actions: { edit: true, activate: true, recordProgress: false },
      });
      const incomplete = await fails(
        s.staffA.post(`/therapy-plans/${bare.id}/activate`, {
          revision: bare.revision,
        }),
        400,
      );
      expect(Object.keys(incomplete.errors!).sort()).toEqual([
        'goals',
        'sessionsPerPeriod',
      ]);

      // The draft's goal list is edited as a whole: kept by id, added, removed.
      const withGoals = await ok<Plan>(
        s.staffA.patch(`/therapy-plans/${bare.id}`, {
          revision: bare.revision,
          sessionsPerPeriod: 3,
          frequencyUnit: 'WEEK',
          goals: [narrativeGoal, percentGoal, { title: 'Third goal' }],
        }),
      );
      expect(withGoals.goals.map((g) => g.title)).toEqual([
        narrativeGoal.title,
        percentGoal.title,
        'Third goal',
      ]);
      expect(withGoals.goals.every((g) => g.status === 'NOT_STARTED')).toBe(
        true,
      );
      const [first, second] = withGoals.goals;
      const trimmed = await ok<Plan>(
        s.staffA.patch(`/therapy-plans/${bare.id}`, {
          revision: withGoals.revision,
          goals: [
            { id: second.id, ...percentGoal, targetValue: 90 },
            { id: first.id, ...narrativeGoal },
          ],
        }),
      );
      expect(trimmed.goals.map((g) => [g.id, g.target.value])).toEqual([
        [second.id, 90],
        [first.id, null],
      ]);
      // Stale revisions are refused.
      expect(
        (
          await fails(
            s.staffA.patch(`/therapy-plans/${bare.id}`, {
              revision: withGoals.revision,
              title: 'Late edit',
            }),
            409,
          )
        ).code,
      ).toBe('PLAN_CHANGED');

      const active = await ok<Plan>(
        s.staffA.post(`/therapy-plans/${bare.id}/activate`, {
          revision: trimmed.revision,
        }),
      );
      expect(active).toMatchObject({
        status: 'ACTIVE',
        frequency: { label: '3 sessions per week' },
        history: [{ number: 1, event: 'ACTIVATED' }],
        actions: { edit: false, recordProgress: true, review: true },
      });
      // A second plan gets the next code; codes are never reused.
      const next = await ok<Plan>(
        s.staffA.post('/therapy-plans', planFor(s, { patientId: s.other.id })),
        201,
      );
      expect(next.code).toBe('TP-0002');
    });

    it('starts from a completed assessment, importing only the chosen goals', async () => {
      const s = await setup();
      const options = await ok<{
        items: {
          id: string;
          recommendations: {
            therapyType: { id: string };
            sessionsPerWeek: number;
          }[];
          goals: { id: string; title: string }[];
        }[];
      }>(
        s.staffA.get(
          `/therapy-plans/assessment-options?patientId=${s.ayaan.id}`,
        ),
      );
      expect(options.items).toHaveLength(1);
      const source = options.items[0];
      expect(source.recommendations.map((r) => r.therapyType.id)).toEqual([
        s.t.OT,
        s.t.SLT,
      ]);
      const pencil = source.goals[0];

      const plan = await ok<Plan>(
        s.staffA.post(
          '/therapy-plans',
          planFor(s, {
            sourceAssessmentId: source.id,
            goals: [
              {
                sourceAssessmentGoalId: pencil.id,
                title: pencil.title,
                priority: 'HIGH',
              },
            ],
          }),
        ),
        201,
      );
      expect(plan.sourceAssessment).toMatchObject({ id: source.id });
      expect(plan.goals).toHaveLength(1);
      expect(plan.goals[0]).toMatchObject({
        title: pencil.title,
        sourceAssessmentGoalId: pencil.id,
      });

      // Editing the plan's copy never touches the assessment.
      await ok(
        s.staffA.patch(`/therapy-plans/${plan.id}`, {
          revision: plan.revision,
          goals: [
            { id: plan.goals[0].id, title: 'Tripod grasp for 5 minutes' },
          ],
        }),
      );
      const assessment = await ok<{
        content: { goals: { title: string }[] };
      }>(s.staffA.get(`/assessments/${s.assessmentId}`));
      expect(assessment.content.goals.map((g) => g.title)).toEqual([
        'Hold a pencil with a tripod grasp',
        'Dress independently',
      ]);

      // A goal that isn't in the source assessment can't claim to be.
      const bogus = await fails(
        s.staffA.post(
          '/therapy-plans',
          planFor(s, {
            sourceAssessmentId: source.id,
            goals: [
              {
                sourceAssessmentGoalId: '00000000-0000-4000-8000-000000000000',
                title: 'Made up',
              },
            ],
          }),
        ),
        400,
      );
      expect(bogus.errors).toHaveProperty(['goals.0.sourceAssessmentGoalId']);

      // The assessment recommended SLT, so an SLT plan may be based on it; ABA wasn't.
      const sltTherapist = await therapist(s.admin, [s.t.SLT]);
      void sltTherapist;
      const aba = await fails(
        s.staffA.post(
          '/therapy-plans',
          planFor(s, {
            therapyTypeId: s.t.ABA,
            durationMinutes: 60,
            sourceAssessmentId: source.id,
            goals: [],
          }),
        ),
        400,
      );
      expect(aba.code).toBe('ASSESSMENT_THERAPY_MISMATCH');
    });

    it('refuses draft assessments and other patients’ assessments as a source', async () => {
      const s = await setup();
      const draft = await ok<{ id: string }>(
        s.staffA.post('/assessments', {
          patientId: s.ayaan.id,
          therapyTypeId: s.t.OT,
          type: 'FOLLOW_UP',
          templateId: s.template.id,
          therapistId: s.a.id,
          assessmentDate: today(),
        }),
        201,
      );
      const incomplete = await fails(
        s.staffA.post(
          '/therapy-plans',
          planFor(s, { sourceAssessmentId: draft.id }),
        ),
        400,
      );
      expect(incomplete.code).toBe('ASSESSMENT_NOT_COMPLETED');
      const wrongPatient = await fails(
        s.staffA.post(
          '/therapy-plans',
          planFor(s, {
            patientId: s.other.id,
            sourceAssessmentId: s.assessmentId,
          }),
        ),
        400,
      );
      expect(wrongPatient.code).toBe('ASSESSMENT_PATIENT_MISMATCH');
    });

    it('checks the therapist, the duration and the dates', async () => {
      const s = await setup();
      // B doesn't provide ABA.
      const unqualified = await fails(
        s.admin.post(
          '/therapy-plans',
          planFor(s, {
            therapyTypeId: s.t.ABA,
            therapistId: s.b.id,
            durationMinutes: 60,
          }),
        ),
        400,
      );
      expect(unqualified.code).toBe('THERAPIST_NOT_SPECIALIZED');
      // A therapist without an account can't run a plan.
      expect(
        (
          await fails(
            s.admin.post(
              '/therapy-plans',
              planFor(s, { therapistId: s.noAccount.id }),
            ),
            400,
          )
        ).code,
      ).toBe('THERAPIST_NO_ACCOUNT');
      // Therapists can only name themselves (they don't see colleagues).
      expect(
        (
          await fails(
            s.staffA.post(
              '/therapy-plans',
              planFor(s, { therapistId: s.b.id }),
            ),
            400,
          )
        ).code,
      ).toBe('THERAPIST_NOT_FOUND');
      // Durations come from the therapy's options unless the center allows custom ones.
      const duration = await fails(
        s.staffA.post('/therapy-plans', planFor(s, { durationMinutes: 50 })),
        400,
      );
      expect(duration.errors?.durationMinutes).toMatch(/30, 45, 60/);
      await ok(
        s.admin.patch('/settings/scheduling', { allowCustomDuration: true }),
      );
      await ok(
        s.staffA.post('/therapy-plans', planFor(s, { durationMinutes: 50 })),
        201,
      );
      const dates = await fails(
        s.staffA.post(
          '/therapy-plans',
          planFor(s, {
            targetEndDate: daysFromToday(-1),
            sessionsPerPeriod: 30,
            frequencyUnit: 'WEEK',
          }),
        ),
        400,
      );
      expect(Object.keys(dates.errors!).sort()).toEqual([
        'sessionsPerPeriod',
        'targetEndDate',
      ]);
      // Without frequency unit, sessions alone are incomplete.
      expect(
        (
          await fails(
            s.staffA.post(
              '/therapy-plans',
              planFor(s, { frequencyUnit: null }),
            ),
            400,
          )
        ).errors,
      ).toHaveProperty('frequencyUnit');
    });

    it('validates goal measurements and categories', async () => {
      const s = await setup();
      const bad = await fails(
        s.staffA.post(
          '/therapy-plans',
          planFor(s, {
            goals: [
              { title: 'Narrative with a number', baselineValue: 3 },
              {
                title: 'Over 100%',
                measurementType: 'PERCENTAGE',
                targetValue: 120,
              },
              { title: 'Duration without unit', measurementType: 'DURATION' },
              {
                title: 'Rating out of range',
                measurementType: 'RATING_SCALE',
                measurementConfig: { scaleMin: 1, scaleMax: 5 },
                targetValue: 7,
              },
            ],
          }),
        ),
        400,
      );
      expect(bad.errors).toMatchObject({
        'goals.0.baselineValue': expect.stringMatching(/Narrative/),
        'goals.1.targetValue': 'Enter a percentage from 0 to 100',
        'goals.2.measurementConfig.unit': 'Choose seconds, minutes or hours',
        'goals.3.targetValue': 'Enter a whole number from 1 to 5',
      });
      const unknown = await fails(
        s.staffA.post(
          '/therapy-plans',
          planFor(s, { goals: [{ title: 'Score', measurementType: 'SCORE' }] }),
        ),
        400,
      );
      expect(unknown.errors).toEqual({
        'goals.0.measurementType': 'Choose how the goal is measured',
      });

      // Categories: center-defined, optionally per therapy, deactivated ones kept.
      const fineMotor = await ok<{ id: string }>(
        s.admin.post('/therapy-goal-categories', {
          name: 'Fine Motor',
          therapyTypeId: s.t.OT,
        }),
        201,
      );
      const general = await ok<{ id: string }>(
        s.admin.post('/therapy-goal-categories', { name: 'Communication' }),
        201,
      );
      const speech = await ok<{ id: string }>(
        s.admin.post('/therapy-goal-categories', {
          name: 'Speech Production',
          therapyTypeId: s.t.SLT,
        }),
        201,
      );
      expect(
        (
          await fails(
            s.admin.post('/therapy-goal-categories', {
              name: 'fine motor',
              therapyTypeId: s.t.OT,
            }),
            409,
          )
        ).code,
      ).toBe('CATEGORY_NAME_TAKEN');
      // The same name for another therapy is fine.
      await ok(
        s.admin.post('/therapy-goal-categories', {
          name: 'Fine Motor',
          therapyTypeId: s.t.ABA,
        }),
        201,
      );
      // Therapists read categories but don't manage them.
      const forOt = await ok<{ id: string }[]>(
        s.staffA.get(`/therapy-goal-categories?therapyTypeId=${s.t.OT}`),
      );
      expect(forOt.map((c) => c.id).sort()).toEqual(
        [fineMotor.id, general.id].sort(),
      );
      await fails(
        s.staffA.post('/therapy-goal-categories', { name: 'Mine' }),
        403,
      );

      const plan = await ok<Plan>(
        s.staffA.post(
          '/therapy-plans',
          planFor(s, {
            goals: [
              { ...narrativeGoal, categoryId: fineMotor.id },
              { title: 'Uncategorized goal' },
              {
                title: 'Hand use',
                measurementType: 'DURATION',
                measurementConfig: { unit: 'MINUTES' },
                baselineValue: 2,
                targetValue: 10,
                categoryId: general.id,
              },
            ],
          }),
        ),
        201,
      );
      expect(plan.goals.map((g) => g.category?.name ?? null)).toEqual([
        'Fine Motor',
        null,
        'Communication',
      ]);
      expect(plan.goals[2]).toMatchObject({
        measurementType: 'DURATION',
        measurementConfig: { unit: 'MINUTES' },
        baseline: { value: 2 },
        target: { value: 10 },
      });
      const wrongTherapy = await fails(
        s.staffA.post(
          '/therapy-plans',
          planFor(s, { goals: [{ title: 'Speech', categoryId: speech.id }] }),
        ),
        400,
      );
      expect(wrongTherapy.errors?.['goals.0.categoryId']).toMatch(
        /another therapy/,
      );

      // Deactivated: not for new goals, but goals using it keep it.
      await ok(
        s.admin.patch(`/therapy-goal-categories/${fineMotor.id}/status`, {
          isActive: false,
        }),
      );
      expect(
        (
          await fails(
            s.staffA.post(
              '/therapy-plans',
              planFor(s, {
                goals: [{ title: 'New', categoryId: fineMotor.id }],
              }),
            ),
            400,
          )
        ).errors?.['goals.0.categoryId'],
      ).toMatch(/inactive/);
      const reloaded = await ok<Plan>(
        s.staffA.get(`/therapy-plans/${plan.id}`),
      );
      expect(reloaded.goals[0].category?.name).toBe('Fine Motor');
      const kept = await ok<Plan>(
        s.staffA.patch(`/therapy-plans/${plan.id}`, {
          revision: reloaded.revision,
          goals: reloaded.goals.map((g) => ({
            id: g.id,
            title: g.title,
            categoryId: g.category?.id ?? null,
            measurementType: g.measurementType,
            measurementConfig: g.measurementConfig,
            baselineValue: g.baseline.value,
            targetValue: g.target.value,
          })),
        }),
      );
      expect(kept.goals[0].category?.name).toBe('Fine Motor');
    });
  });

  describe('lifecycle', () => {
    it('allows one plan in force per patient and therapy', async () => {
      const s = await setup();
      const first = await activePlan(s);
      // Other therapies run side by side.
      await activePlan(s, {
        therapyTypeId: s.t.ABA,
        durationMinutes: 60,
        title: 'ABA plan',
      });
      // A second OT draft is fine; activating it isn't.
      const second = await ok<Plan>(
        s.staffA.post(
          '/therapy-plans',
          planFor(s, { title: 'Second OT plan' }),
        ),
        201,
      );
      const duplicate = await fails(
        s.staffA.post(`/therapy-plans/${second.id}/activate`, {
          revision: second.revision,
        }),
        409,
      );
      expect(duplicate).toMatchObject({
        code: 'PLAN_ALREADY_ACTIVE',
        planId: first.id,
      });
      // The database refuses it too.
      await expect(
        prisma.therapyPlan.update({
          where: { id: second.id },
          data: {
            status: 'ACTIVE',
            activatedAt: new Date(),
            activatedById: (await prisma.user.findFirstOrThrow()).id,
          },
        }),
      ).rejects.toThrow();
      // Pausing still counts as in force; completing frees the slot.
      const paused = await ok<Plan>(
        s.staffA.post(`/therapy-plans/${first.id}/pause`, {
          revision: first.revision,
          reason: 'Family travelling for a month',
        }),
      );
      await fails(
        s.staffA.post(`/therapy-plans/${second.id}/activate`, {
          revision: second.revision,
        }),
        409,
      );
      await ok(
        s.staffA.post(`/therapy-plans/${first.id}/complete`, {
          revision: paused.revision,
          completionSummary: 'Goals met; discharged to home programme.',
        }),
      );
      await ok(
        s.staffA.post(`/therapy-plans/${second.id}/activate`, {
          revision: second.revision,
        }),
      );
    });

    it('pauses, resumes, completes and discontinues with reasons, and nothing else', async () => {
      const s = await setup();
      const plan = await activePlan(s);
      expect(
        (
          await fails(
            s.staffA.post(`/therapy-plans/${plan.id}/pause`, {
              revision: plan.revision,
            }),
            400,
          )
        ).errors,
      ).toHaveProperty('reason');
      expect(
        (
          await fails(
            s.staffA.post(`/therapy-plans/${plan.id}/resume`, {
              revision: plan.revision,
            }),
            409,
          )
        ).code,
      ).toBe('PLAN_STATUS');
      const paused = await ok<Plan>(
        s.staffA.post(`/therapy-plans/${plan.id}/pause`, {
          revision: plan.revision,
          reason: 'Hospital admission',
        }),
      );
      expect(paused).toMatchObject({
        status: 'PAUSED',
        statusReason: 'Hospital admission',
        actions: { resume: true, pause: false, recordProgress: false },
      });
      const resumed = await ok<Plan>(
        s.staffA.post(`/therapy-plans/${plan.id}/resume`, {
          revision: paused.revision,
          note: 'Back from hospital',
        }),
      );
      expect(resumed.status).toBe('ACTIVE');
      expect(
        (
          await fails(
            s.staffA.post(`/therapy-plans/${plan.id}/complete`, {
              revision: resumed.revision,
            }),
            400,
          )
        ).errors,
      ).toHaveProperty('completionSummary');
      const completed = await ok<Plan>(
        s.staffA.post(`/therapy-plans/${plan.id}/complete`, {
          revision: resumed.revision,
          completionSummary: 'Independent with handwriting tasks.',
        }),
      );
      expect(completed).toMatchObject({
        status: 'COMPLETED',
        completionSummary: 'Independent with handwriting tasks.',
        actions: { revise: false, review: false, pause: false },
      });
      expect(completed.history.map((h) => h.event)).toEqual([
        'COMPLETED',
        'RESUMED',
        'PAUSED',
        'ACTIVATED',
      ]);
      expect(completed.history[2].reason).toBe('Hospital admission');

      // Closed is final, through the API and in the database.
      for (const [action, extra] of [
        ['activate', {}],
        ['pause', { reason: 'Try' }],
        ['resume', {}],
        ['discontinue', { reason: 'Try' }],
      ] as const) {
        const refused = await fails(
          s.staffA.post(`/therapy-plans/${plan.id}/${action}`, {
            revision: completed.revision,
            ...extra,
          }),
          409,
        );
        expect(refused.code).toBe('PLAN_STATUS');
      }
      await fails(
        s.staffA.post(`/therapy-plans/${plan.id}/revise`, {
          revision: completed.revision,
          reason: 'Late change',
          title: 'Renamed',
        }),
        409,
      );
      await fails(
        s.staffA.post(`/therapy-plans/${plan.id}/goals`, {
          title: 'Late goal',
          reason: 'Forgot one',
        }),
        409,
      );
      await expect(
        prisma.therapyPlan.update({
          where: { id: plan.id },
          data: { title: 'Changed behind the API' },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.therapyPlan.delete({ where: { id: plan.id } }),
      ).rejects.toThrow();

      // Discontinuing needs a reason and keeps everything.
      const other = await activePlan(s, { patientId: s.other.id });
      expect(
        (
          await fails(
            s.staffA.post(`/therapy-plans/${other.id}/discontinue`, {
              revision: other.revision,
              reason: '',
            }),
            400,
          )
        ).errors,
      ).toHaveProperty('reason');
      const stopped = await ok<Plan>(
        s.staffA.post(`/therapy-plans/${other.id}/discontinue`, {
          revision: other.revision,
          reason: 'Family moved to another city',
        }),
      );
      expect(stopped).toMatchObject({
        status: 'DISCONTINUED',
        statusReason: 'Family moved to another city',
      });
      expect(stopped.goals).toHaveLength(2);
      // Drafts can be discarded; plans that were active can't.
      const draft = await ok<Plan>(
        s.staffA.post('/therapy-plans', planFor(s, { title: 'Scrap' })),
        201,
      );
      expect((await s.staffA.delete(`/therapy-plans/${draft.id}`)).status).toBe(
        204,
      );
      await fails(s.staffA.delete(`/therapy-plans/${other.id}`), 409);
    });

    it('revises an active plan, keeping the earlier values in its history', async () => {
      const s = await setup();
      const plan = await activePlan(s);
      expect(
        (
          await fails(
            s.staffA.post(`/therapy-plans/${plan.id}/revise`, {
              revision: plan.revision,
              reason: 'No change',
            }),
            400,
          )
        ).code,
      ).toBe('NOTHING_CHANGED');
      await fails(
        s.staffA.patch(`/therapy-plans/${plan.id}`, {
          revision: plan.revision,
          title: 'Draft-style edit',
        }),
        409,
      );
      const revised = await ok<Plan>(
        s.staffA.post(`/therapy-plans/${plan.id}/revise`, {
          revision: plan.revision,
          reason: 'Good progress at the 8-week review',
          sessionsPerPeriod: 2,
          nextReviewDate: daysFromToday(90),
        }),
      );
      expect(revised.frequency.label).toBe('2 sessions per week');
      const entry = revised.history[0];
      expect(entry).toMatchObject({
        event: 'REVISED',
        changedFields: ['Frequency', 'Next review date'],
        reason: 'Good progress at the 8-week review',
        previousSnapshot: { sessionsPerPeriod: 3, frequencyUnit: 'WEEK' },
        newSnapshot: { sessionsPerPeriod: 2, frequencyUnit: 'WEEK' },
      });
      expect(revised.goals).toHaveLength(2);
      // The database keeps history append-only.
      const row = await prisma.therapyPlanRevision.findFirstOrThrow({
        where: { therapyPlanId: plan.id },
      });
      await expect(
        prisma.therapyPlanRevision.update({
          where: { id: row.id },
          data: { reason: 'Rewritten' },
        }),
      ).rejects.toThrow();

      // Goals of an active plan: added and changed with a reason, never deleted.
      const noReason = await fails(
        s.staffA.post(`/therapy-plans/${plan.id}/goals`, {
          title: 'Use scissors',
        }),
        400,
      );
      expect(noReason.code).toBe('REASON_REQUIRED');
      const added = await ok<Goal>(
        s.staffA.post(`/therapy-plans/${plan.id}/goals`, {
          title: 'Use scissors',
          reason: 'New concern raised by school',
        }),
        201,
      );
      const goal = revised.goals[1];
      await fails(
        s.staffA.patch(`/therapy-plans/${plan.id}/goals/${goal.id}`, {
          targetValue: 90,
        }),
        400,
      );
      const achieved = await ok<Goal>(
        s.staffA.patch(`/therapy-plans/${plan.id}/goals/${goal.id}`, {
          status: 'ACHIEVED',
        }),
      );
      expect(achieved.status).toBe('ACHIEVED');
      await fails(
        s.staffA.delete(`/therapy-plans/${plan.id}/goals/${added.id}`),
        409,
      );
      const after = await ok<Plan>(s.staffA.get(`/therapy-plans/${plan.id}`));
      expect(after.history.slice(0, 2).map((h) => h.event)).toEqual([
        'GOAL_UPDATED',
        'GOAL_ADDED',
      ]);
      expect(after.history[0]).toMatchObject({
        changedFields: ['Status'],
        previousSnapshot: { status: 'NOT_STARTED' },
        newSnapshot: { status: 'ACHIEVED' },
      });
      // Achieved goals stay on the plan.
      expect(after.goals.map((g) => g.status)).toEqual([
        'NOT_STARTED',
        'ACHIEVED',
        'NOT_STARTED',
      ]);
    });

    it('reassigns a plan with an audit trail, keeping earlier authorship', async () => {
      const s = await setup();
      const plan = await activePlan(s);
      const goal = plan.goals[0];
      await ok(
        s.staffA.post(`/therapy-plans/${plan.id}/goals/${goal.id}/progress`, {
          observationDate: today(),
          observation: 'Needs hand-over-hand support',
        }),
        201,
      );
      // Therapists can't reassign; managers can, without clinical access.
      await fails(
        s.staffA.post(`/therapy-plans/${plan.id}/reassign`, {
          revision: plan.revision,
          therapistId: s.b.id,
          reason: 'Leaving',
        }),
        403,
      );
      const asManager = await ok<Plan>(
        s.manager.get(`/therapy-plans/${plan.id}`),
      );
      expect(asManager).toMatchObject({
        clinicalAccess: false,
        goals: [],
        actions: { reassign: true, view: false },
      });
      const reassigned = await ok<Plan>(
        s.manager.post(`/therapy-plans/${plan.id}/reassign`, {
          revision: plan.revision,
          therapistId: s.b.id,
          reason: 'Farhana is on extended leave',
        }),
      );
      expect(reassigned.therapist.id).toBe(s.b.id);
      const asB = await ok<Plan>(s.staffB.get(`/therapy-plans/${plan.id}`));
      expect(asB).toMatchObject({
        clinicalAccess: true,
        actions: { recordProgress: true, review: true },
      });
      expect(asB.history[0]).toMatchObject({
        event: 'THERAPIST_REASSIGNED',
        reason: 'Farhana is on extended leave',
        previousSnapshot: { therapist: { id: s.a.id } },
        newSnapshot: { therapist: { id: s.b.id } },
      });
      const progress = await ok<{ items: Progress[] }>(
        s.staffB.get(`/therapy-plans/${plan.id}/goals/${goal.id}/progress`),
      );
      expect(progress.items[0].recordedBy.fullName).toBe('Farhana Akter');
      // A is no longer the one who changes it.
      expect(
        (
          await fails(
            s.staffA.post(
              `/therapy-plans/${plan.id}/goals/${goal.id}/progress`,
              {
                observationDate: today(),
                observation: 'More',
              },
            ),
            403,
          )
        ).code,
      ).toBe('NOT_RESPONSIBLE_THERAPIST');
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'therapy_plan.reassigned', entityId: plan.id },
      });
      expect(audit.metadata).toMatchObject({
        fromTherapistId: s.a.id,
        toTherapistId: s.b.id,
      });
    });
  });

  describe('progress', () => {
    it('records narrative and numeric progress chronologically, with corrections', async () => {
      const s = await setup();
      const plan = await activePlan(s, { startDate: daysFromToday(-30) });
      const [narrative, percent] = plan.goals;
      const path = (g: Goal) =>
        `/therapy-plans/${plan.id}/goals/${g.id}/progress`;

      const first = await ok<{ entry: Progress; goal: Goal }>(
        s.staffA.post(path(narrative), {
          observationDate: daysFromToday(-10),
          observation: 'Picks up beads with moderate assistance',
          goalStatus: 'IN_PROGRESS',
        }),
        201,
      );
      expect(first.goal).toMatchObject({
        status: 'IN_PROGRESS',
        latestProgress: {
          observation: 'Picks up beads with moderate assistance',
        },
      });
      // Narrative goals take no numbers.
      expect(
        (
          await fails(
            s.staffA.post(path(narrative), {
              observationDate: today(),
              measuredValue: 50,
            }),
            400,
          )
        ).errors,
      ).toHaveProperty('measuredValue');

      // Numeric values are checked; entries may be recorded out of order.
      expect(
        (
          await fails(
            s.staffA.post(path(percent), {
              observationDate: today(),
              measuredValue: 130,
            }),
            400,
          )
        ).errors?.measuredValue,
      ).toBe('Enter a percentage from 0 to 100');
      const later = await ok<{ entry: Progress }>(
        s.staffA.post(path(percent), {
          observationDate: daysFromToday(-2),
          measuredValue: 60,
        }),
        201,
      );
      await ok(
        s.staffA.post(path(percent), {
          observationDate: daysFromToday(-20),
          measuredValue: 40,
          observation: 'First probe',
        }),
        201,
      );
      // Reaching the target doesn't mark the goal achieved; the clinician does.
      const atTarget = await ok<{ goal: Goal }>(
        s.staffA.post(path(percent), {
          observationDate: daysFromToday(-1),
          measuredValue: 80,
        }),
        201,
      );
      expect(atTarget.goal.status).toBe('NOT_STARTED');

      // Dates are checked against today and the plan's start.
      expect(
        (
          await fails(
            s.staffA.post(path(percent), {
              observationDate: daysFromToday(1),
              measuredValue: 10,
            }),
            400,
          )
        ).errors,
      ).toHaveProperty('observationDate');
      expect(
        (
          await fails(
            s.staffA.post(path(percent), {
              observationDate: daysFromToday(-31),
              measuredValue: 10,
            }),
            400,
          )
        ).errors,
      ).toHaveProperty('observationDate');
      expect(
        (
          await fails(
            s.staffA.post(path(percent), { observationDate: today() }),
            400,
          )
        ).errors,
      ).toHaveProperty('observation');

      // A correction replaces an entry, needs a reason, and keeps the original.
      await fails(
        s.staffA.post(path(percent), {
          observationDate: daysFromToday(-2),
          measuredValue: 65,
          correctsId: later.entry.id,
        }),
        400,
      );
      await ok(
        s.staffA.post(path(percent), {
          observationDate: daysFromToday(-2),
          measuredValue: 65,
          correctsId: later.entry.id,
          correctionReason: 'Miscounted trials',
        }),
        201,
      );
      expect(
        (
          await fails(
            s.staffA.post(path(percent), {
              observationDate: daysFromToday(-2),
              measuredValue: 66,
              correctsId: later.entry.id,
              correctionReason: 'Again',
            }),
            409,
          )
        ).code,
      ).toBe('PROGRESS_ALREADY_CORRECTED');

      const history = await ok<{ items: Progress[] }>(
        s.staffA.get(path(percent)),
      );
      expect(
        history.items.map((p) => [
          p.observationDate,
          p.measuredValue,
          p.isCorrected,
        ]),
      ).toEqual([
        [daysFromToday(-20), 40, false],
        [daysFromToday(-2), 60, true],
        [daysFromToday(-2), 65, false],
        [daysFromToday(-1), 80, false],
      ]);
      const all = await ok<{ items: Progress[] }>(
        s.staffA.get(`/therapy-plans/${plan.id}/progress`),
      );
      expect(all.items).toHaveLength(5);
      // Entries are append-only in the database.
      await expect(
        prisma.therapyGoalProgress.delete({ where: { id: later.entry.id } }),
      ).rejects.toThrow();

      // A goal with progress keeps its measurement.
      expect(
        (
          await fails(
            s.staffA.patch(`/therapy-plans/${plan.id}/goals/${percent.id}`, {
              measurementType: 'COUNT',
              reason: 'Count instead',
            }),
            409,
          )
        ).code,
      ).toBe('GOAL_HAS_PROGRESS');

      // Progress needs the plan active.
      const reloaded = await ok<Plan>(
        s.staffA.get(`/therapy-plans/${plan.id}`),
      );
      expect(reloaded.goals[1].latestProgress?.measuredValue).toBe(80);
      await ok(
        s.staffA.post(`/therapy-plans/${plan.id}/pause`, {
          revision: reloaded.revision,
          reason: 'Holiday',
        }),
      );
      await fails(
        s.staffA.post(path(percent), {
          observationDate: today(),
          measuredValue: 85,
        }),
        409,
      );
    });
  });

  describe('reviews', () => {
    it('records reviews with a snapshot, changes nothing else, and keeps corrections', async () => {
      const s = await setup();
      const plan = await activePlan(s, { startDate: daysFromToday(-60) });
      const percent = plan.goals[1];
      await ok(
        s.staffA.post(
          `/therapy-plans/${plan.id}/goals/${percent.id}/progress`,
          {
            observationDate: daysFromToday(-3),
            measuredValue: 55,
            goalStatus: 'IN_PROGRESS',
          },
        ),
        201,
      );
      const missing = await fails(
        s.staffA.post(`/therapy-plans/${plan.id}/reviews`, {
          reviewDate: today(),
        }),
        400,
      );
      expect(Object.keys(missing.errors!).sort()).toEqual([
        'overallProgress',
        'recommendation',
      ]);
      const review = await ok<{
        id: string;
        number: number;
        recommendation: string;
        goalSnapshot: {
          title: string;
          status: string;
          latestProgress: { measuredValue: number } | null;
        }[];
        planSnapshot: { frequency: string };
        actions: { amend: boolean };
      }>(
        s.staffA.post(`/therapy-plans/${plan.id}/reviews`, {
          reviewDate: today(),
          overallProgress: 'MODERATE',
          recommendation: 'DECREASE_FREQUENCY',
          observations: 'Improved grasp; tolerates longer tasks.',
          nextReviewDate: daysFromToday(42),
        }),
        201,
      );
      expect(review).toMatchObject({
        number: 1,
        planSnapshot: { frequency: '3 sessions per week' },
        actions: { amend: true },
      });
      expect(review.goalSnapshot[1]).toMatchObject({
        title: percent.title,
        status: 'IN_PROGRESS',
        latestProgress: { measuredValue: 55 },
      });
      // Only the next review date moves; the recommendation is acted on explicitly.
      const after = await ok<Plan>(s.staffA.get(`/therapy-plans/${plan.id}`));
      expect(after).toMatchObject({
        status: 'ACTIVE',
        nextReviewDate: daysFromToday(42),
        frequency: { sessionsPerPeriod: 3 },
        reviews: [{ number: 1 }],
      });
      const revised = await ok<Plan>(
        s.staffA.post(`/therapy-plans/${plan.id}/revise`, {
          revision: after.revision,
          sessionsPerPeriod: 2,
          reason: 'Per review 1',
          reviewId: review.id,
        }),
      );
      expect(revised.frequency.sessionsPerPeriod).toBe(2);

      // Corrections keep the review as it was.
      const amended = await ok<{
        recommendation: string;
        amendments: {
          number: number;
          reason: string;
          changedFields: string[];
          previousContent: { recommendation: string };
        }[];
      }>(
        s.staffA.post(`/therapy-plans/${plan.id}/reviews/${review.id}/amend`, {
          recommendation: 'MODIFY',
          reason: 'Selected the wrong recommendation',
        }),
      );
      expect(amended).toMatchObject({
        recommendation: 'MODIFY',
        amendments: [
          {
            number: 1,
            changedFields: ['Recommendation'],
            previousContent: { recommendation: 'DECREASE_FREQUENCY' },
          },
        ],
      });
      await fails(
        s.staffA.post(`/therapy-plans/${plan.id}/reviews/${review.id}/amend`, {
          reason: 'Nothing really',
        }),
        400,
      );
      await expect(
        prisma.therapyPlanReview.delete({ where: { id: review.id } }),
      ).rejects.toThrow();
      // Reviews need a plan in force and its own therapist.
      await fails(
        s.staffB.post(`/therapy-plans/${plan.id}/reviews`, {
          reviewDate: today(),
          overallProgress: 'MINIMAL',
          recommendation: 'CONTINUE',
        }),
        404,
      );
      expect(
        (
          await fails(
            s.staffA.post(`/therapy-plans/${plan.id}/reviews`, {
              reviewDate: daysFromToday(1),
              overallProgress: 'MINIMAL',
              recommendation: 'CONTINUE',
            }),
            400,
          )
        ).errors,
      ).toHaveProperty('reviewDate');
    });
  });

  describe('lists', () => {
    it('filters by review due, therapy and status, and lists a patient’s plans', async () => {
      const s = await setup();
      const overdue = await activePlan(s, {
        startDate: daysFromToday(-60),
        nextReviewDate: daysFromToday(-1),
      });
      const soon = await activePlan(s, {
        therapyTypeId: s.t.ABA,
        durationMinutes: 60,
        nextReviewDate: daysFromToday(5),
      });
      const later = await activePlan(s, {
        patientId: s.other.id,
        nextReviewDate: daysFromToday(60),
      });
      const draft = await ok<Plan>(
        s.staffA.post(
          '/therapy-plans',
          planFor(s, {
            title: 'Next OT plan',
            startDate: daysFromToday(-60),
            nextReviewDate: daysFromToday(-1),
          }),
        ),
        201,
      );
      const ids = (body: { items: { id: string }[] }) =>
        body.items.map((p) => p.id);

      const overdueList = await ok<{
        items: { id: string; reviewState: string }[];
      }>(s.admin.get('/therapy-plans?reviewDue=OVERDUE'));
      expect(overdueList.items).toEqual([
        expect.objectContaining({ id: overdue.id, reviewState: 'OVERDUE' }),
      ]);
      expect(
        ids(
          await ok(s.admin.get('/therapy-plans?reviewDue=NEXT_7_DAYS')),
        ).sort(),
      ).toEqual([overdue.id, soon.id].sort());
      expect(
        ids(
          await ok(
            s.admin.get('/therapy-plans?sortBy=nextReviewDate&status=ACTIVE'),
          ),
        ),
      ).toEqual([overdue.id, soon.id, later.id]);
      expect(
        ids(await ok(s.admin.get(`/therapy-plans?therapyTypeId=${s.t.ABA}`))),
      ).toEqual([soon.id]);
      expect(ids(await ok(s.admin.get('/therapy-plans?status=DRAFT')))).toEqual(
        [draft.id],
      );
      expect(ids(await ok(s.admin.get('/therapy-plans?search=Zara')))).toEqual([
        later.id,
      ]);
      expect(
        ids(await ok(s.admin.get(`/therapy-plans?search=${later.code}`))),
      ).toEqual([later.id]);
      const paged = await ok<{ items: unknown[]; total: number }>(
        s.admin.get('/therapy-plans?pageSize=2&page=2'),
      );
      expect(paged).toMatchObject({ total: 4 });
      expect(paged.items).toHaveLength(2);

      const forAyaan = await ok<{
        items: { id: string; status: string; goalSummary: { total: number } }[];
      }>(s.staffA.get(`/patients/${s.ayaan.id}/therapy-plans`));
      // In force first, then drafts.
      expect(forAyaan.items.map((p) => p.status)).toEqual([
        'ACTIVE',
        'ACTIVE',
        'DRAFT',
      ]);
      expect(forAyaan.items[0].goalSummary.total).toBe(2);
    });
  });

  describe('access', () => {
    it('limits clinical content and writes to the right people', async () => {
      const s = await setup();
      const plan = await activePlan(s);
      const draft = await ok<Plan>(
        s.staffA.post('/therapy-plans', planFor(s, { patientId: s.other.id })),
        201,
      );

      // Front desk: status only, no creating, no clinical writes.
      const asDesk = await ok<{ items: Plan[] }>(s.desk.get('/therapy-plans'));
      expect(asDesk.items).toHaveLength(2);
      expect(asDesk.items.every((p) => p.goalSummary === null)).toBe(true);
      const deskDetail = await ok<Plan>(
        s.desk.get(`/therapy-plans/${plan.id}`),
      );
      expect(deskDetail).toMatchObject({
        clinicalAccess: false,
        goals: [],
        reviews: [],
        history: [],
        actions: { view: false, recordProgress: false, reassign: false },
      });
      await fails(s.desk.post('/therapy-plans', planFor(s)), 403);
      await fails(s.desk.get(`/therapy-plans/${plan.id}/goals`), 404);
      await fails(
        s.desk.post(
          `/therapy-plans/${plan.id}/goals/${plan.goals[0].id}/progress`,
          {
            observationDate: today(),
            observation: 'x',
          },
        ),
        403,
      );

      // A therapist with no link to the patient sees nothing.
      expect(
        (await ok<{ items: Plan[] }>(s.staffB.get('/therapy-plans'))).items,
      ).toEqual([]);
      await fails(s.staffB.get(`/therapy-plans/${plan.id}`), 404);
      await fails(s.staffB.get(`/patients/${s.ayaan.id}/therapy-plans`), 404);

      // Once B sees Ayaan, B reads A's active plan but can't change it, and never A's drafts.
      await ok(
        s.admin.post('/appointments', {
          patientId: s.ayaan.id,
          type: 'THERAPY_SESSION',
          therapyTypeId: s.t.OT,
          therapistId: s.b.id,
          durationMinutes: 45,
          date: nextMonday(),
          startTime: '12:00',
        }),
        201,
      );
      const asB = await ok<Plan>(s.staffB.get(`/therapy-plans/${plan.id}`));
      expect(asB).toMatchObject({
        clinicalAccess: true,
        actions: { recordProgress: false, review: false, revise: false },
      });
      expect(
        (
          await fails(
            s.staffB.post(`/therapy-plans/${plan.id}/revise`, {
              revision: plan.revision,
              title: 'Mine now',
              reason: 'Taking over',
            }),
            403,
          )
        ).code,
      ).toBe('NOT_RESPONSIBLE_THERAPIST');
      await fails(s.staffB.get(`/therapy-plans/${draft.id}`), 404);

      // Administrators read every plan's content but don't write others' plans.
      const asAdmin = await ok<Plan>(s.admin.get(`/therapy-plans/${plan.id}`));
      expect(asAdmin).toMatchObject({
        clinicalAccess: true,
        actions: { view: true, recordProgress: false, reassign: true },
      });
      await fails(
        s.admin.post(`/therapy-plans/${plan.id}/pause`, {
          revision: plan.revision,
          reason: 'Admin pause',
        }),
        403,
      );
    });

    it('keeps centers apart', async () => {
      const s = await setup();
      const plan = await activePlan(s);
      const other = await registerCenter(app);
      const otherTypes = (await other.browser.get('/therapy-types')).body as {
        id: string;
        code: string;
      }[];
      const otherOt = otherTypes.find((x) => x.code === 'OT')!.id;

      await fails(other.browser.get(`/therapy-plans/${plan.id}`), 404);
      expect(
        (await ok<{ items: unknown[] }>(other.browser.get('/therapy-plans')))
          .items,
      ).toEqual([]);
      await fails(
        other.browser.post(`/therapy-plans/${plan.id}/reassign`, {
          revision: plan.revision,
          therapistId: s.b.id,
          reason: 'Cross-center',
        }),
        404,
      );
      // Another center's patient, therapist or therapy can't be used.
      expect(
        (
          await fails(
            s.admin.post(
              '/therapy-plans',
              planFor(s, { therapyTypeId: otherOt }),
            ),
            400,
          )
        ).code,
      ).toBe('THERAPY_TYPE_NOT_FOUND');
      const foreignPatient = await ok<{ id: string }>(
        other.browser.post('/patients', {
          fullName: 'Elsewhere',
          contact: {
            contactType: 'GUARDIAN',
            fullName: 'Parent',
            mobile: '01911-000001',
            relationship: 'MOTHER',
          },
        }),
        201,
      );
      expect(
        (
          await fails(
            s.admin.post(
              '/therapy-plans',
              planFor(s, { patientId: foreignPatient.id }),
            ),
            400,
          )
        ).code,
      ).toBe('PATIENT_NOT_FOUND');
      const foreignTherapist = await therapist(other.browser, [otherOt]);
      expect(
        (
          await fails(
            s.admin.post(
              '/therapy-plans',
              planFor(s, { therapistId: foreignTherapist.id }),
            ),
            400,
          )
        ).code,
      ).toBe('THERAPIST_NOT_FOUND');
      await fails(
        other.browser.get(`/patients/${s.ayaan.id}/therapy-plans`),
        404,
      );
    });

    it('keeps history when a therapist or therapy is deactivated', async () => {
      const s = await setup();
      const plan = await activePlan(s);
      await ok(
        s.admin.patch(`/therapists/${s.a.id}/status`, { status: 'INACTIVE' }),
      );
      await ok(
        s.admin.patch(`/therapy-types/${s.t.OT}/status`, { isActive: false }),
      );
      const kept = await ok<
        Plan & {
          therapyType: { id: string; isActive: boolean };
          therapist: { id: string; isActive: boolean };
        }
      >(s.admin.get(`/therapy-plans/${plan.id}`));
      expect(kept).toMatchObject({
        status: 'ACTIVE',
        therapist: { id: s.a.id, isActive: false },
        therapyType: { id: s.t.OT, isActive: false },
      });
      expect(kept.goals).toHaveLength(2);
      // New plans can't use them; the therapy type can't be deleted while in use.
      expect(
        (await fails(s.admin.post('/therapy-plans', planFor(s)), 400)).code,
      ).toBe('THERAPY_TYPE_INACTIVE');
      await fails(s.admin.delete(`/therapy-types/${s.t.OT}`), 409);
    });
  });
});
