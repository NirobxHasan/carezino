import { HttpStatus, Injectable } from '@nestjs/common';

import { localTimes } from '../appointments/appointments.service';
import { isOwn } from '../assessments/access';
import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { isUniqueViolation } from '../centers/centers.service';
import { apiError } from '../common/errors';
import { parseIsoDate } from '../common/time';
import {
  changedAnswerLabels,
  defaultAnswers,
  storedDefinition,
  validateAnswers,
  type Answers,
  type Errors,
} from '../forms/engine';
import type { Prisma } from '../generated/prisma/client';
import {
  AppointmentStatus,
  AppointmentType,
  SessionNoteStatus,
  TherapyGoalStatus,
  TherapyPlanStatus,
  TherapySessionStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { storedConfig, valueError } from '../therapy-plans/measurement';
import { noteNotFound, readableNotes } from './access';
import type {
  AmendNoteDto,
  CompleteNoteDto,
  CreateNoteDto,
  GoalEntryDto,
  UpdateNoteDto,
} from './dto';
import { SessionLifecycle } from './lifecycle.service';
import {
  notResponsible,
  notTherapySession,
  userSelect,
  type Tx,
} from './shared';
import { NoteTemplatesService } from './templates.service';

const noteSelect = {
  id: true,
  appointmentId: true,
  status: true,
  revision: true,
  answers: true,
  draftGoals: true,
  therapyPlanId: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: userSelect,
  updatedBy: userSelect,
  completedBy: userSelect,
  therapist: {
    select: {
      id: true,
      code: true,
      fullName: true,
      designation: true,
      membershipId: true,
    },
  },
  templateVersion: {
    select: {
      id: true,
      version: true,
      status: true,
      definition: true,
      template: { select: { id: true, name: true, description: true } },
    },
  },
  therapyPlan: {
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      startDate: true,
    },
  },
  session: {
    select: {
      status: true,
      appointment: {
        select: {
          id: true,
          type: true,
          status: true,
          startAt: true,
          endAt: true,
          patient: { select: { id: true, code: true, fullName: true } },
          therapyType: {
            select: { id: true, name: true, code: true, color: true },
          },
        },
      },
    },
  },
  amendments: {
    select: {
      number: true,
      reason: true,
      changedFields: true,
      amendedAt: true,
      amendedBy: userSelect,
    },
    orderBy: { number: 'asc' },
  },
  // A note's current progress: its entries that haven't been corrected since.
  progress: {
    where: { correctedBy: { is: null } },
    select: {
      id: true,
      goalId: true,
      observation: true,
      measuredValue: true,
      goalStatus: true,
      createdAt: true,
      recordedBy: userSelect,
    },
  },
} satisfies Prisma.SessionNoteSelect;

type NoteRow = Prisma.SessionNoteGetPayload<{ select: typeof noteSelect }>;

const planGoalSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  measurementType: true,
  measurementConfig: true,
  baselineText: true,
  baselineValue: true,
  targetText: true,
  targetValue: true,
  targetDate: true,
  category: { select: { id: true, name: true } },
  progress: {
    select: { observationDate: true, measuredValue: true, goalStatus: true },
    orderBy: [{ observationDate: 'desc' }, { createdAt: 'desc' }],
    take: 1,
  },
} satisfies Prisma.TherapyPlanGoalSelect;

type PlanGoal = Prisma.TherapyPlanGoalGetPayload<{
  select: typeof planGoalSelect;
}>;

/** Progress for one goal as a note records it. */
export interface GoalEntry {
  goalId: string;
  observation: string | null;
  measuredValue: number | null;
  goalStatus: TherapyGoalStatus | null;
}

interface NoteContent {
  answers: Answers;
  goals: GoalEntry[];
}

const noteChanged = () =>
  apiError(
    HttpStatus.CONFLICT,
    'This note was changed in another tab or by someone else. Reload to see the latest version.',
    'NOTE_CHANGED',
  );

const invalid = (
  errors: Errors,
  message = 'Please check the highlighted fields',
) => apiError(HttpStatus.BAD_REQUEST, message, 'VALIDATION_FAILED', errors);

function asGoals(value: Prisma.JsonValue): GoalEntry[] {
  return Array.isArray(value) ? (value as unknown as GoalEntry[]) : [];
}

const sameEntry = (a: GoalEntry, b: GoalEntry) =>
  a.observation === b.observation &&
  a.measuredValue === b.measuredValue &&
  a.goalStatus === b.goalStatus;

/**
 * Session notes: started from a published template version (forms/engine.ts is the
 * schema), saved as drafts, signed off, and amended with a reason. Only the note's own
 * therapist writes it. Goal progress is held on the draft and written to the therapy
 * plan's TherapyGoalProgress when the note is completed, once per goal (a database
 * index), and amendments add corrections rather than new entries. Recording progress
 * never decides a goal's status: a status is only set when the therapist chooses one.
 */
@Injectable()
export class SessionNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lifecycle: SessionLifecycle,
    private readonly templates: NoteTemplatesService,
  ) {}

  // ── Reading ───────────────────────────────────────────────────────────────

  private async planGoals(planId: string | null): Promise<PlanGoal[]> {
    if (!planId) return [];
    return this.prisma.therapyPlanGoal.findMany({
      where: { therapyPlanId: planId },
      select: planGoalSelect,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** The note's goal progress: the draft's own list, else what was recorded. */
  private goalsOf(row: NoteRow): (GoalEntry & { progressId?: string })[] {
    if (row.status === SessionNoteStatus.DRAFT) return asGoals(row.draftGoals);
    return row.progress.map((p) => ({
      progressId: p.id,
      goalId: p.goalId,
      observation: p.observation,
      measuredValue: p.measuredValue,
      goalStatus: p.goalStatus,
    }));
  }

  private actions(tenant: TenantContext, row: NoteRow) {
    const can = (p: TenantContext['permissions'][number]) =>
      tenant.permissions.includes(p);
    const own = isOwn(tenant, row.therapist);
    const draft = row.status === SessionNoteStatus.DRAFT;
    const appointment = row.session.appointment;
    const documentable =
      appointment.status !== AppointmentStatus.CANCELLED &&
      appointment.status !== AppointmentStatus.NO_SHOW &&
      row.session.status !== TherapySessionStatus.VOIDED;
    return {
      edit: own && draft && documentable && can('session_notes.update_draft'),
      complete: own && draft && documentable && can('session_notes.complete'),
      amend: own && !draft && can('session_notes.amend'),
      discard: own && draft && can('session_notes.update_draft'),
    };
  }

  private async toDetail(tenant: TenantContext, row: NoteRow) {
    const center = await this.lifecycle.center(tenant);
    const appointment = row.session.appointment;
    const goals = await this.planGoals(row.therapyPlanId);
    return {
      id: row.id,
      appointmentId: row.appointmentId,
      status: row.status,
      revision: row.revision,
      session: {
        appointmentId: appointment.id,
        ...localTimes(appointment.startAt, appointment.endAt, center.timeZone),
        appointmentStatus: appointment.status,
        sessionStatus: row.session.status,
        patient: appointment.patient,
        therapyType: appointment.therapyType,
      },
      template: {
        id: row.templateVersion.template.id,
        name: row.templateVersion.template.name,
        description: row.templateVersion.template.description,
        versionId: row.templateVersion.id,
        version: row.templateVersion.version,
        versionStatus: row.templateVersion.status,
      },
      form: storedDefinition(row.templateVersion.definition),
      answers: row.answers as Answers,
      goals: this.goalsOf(row),
      plan: row.therapyPlan && {
        id: row.therapyPlan.id,
        code: row.therapyPlan.code,
        title: row.therapyPlan.title,
        status: row.therapyPlan.status,
      },
      /** The plan's goals, to choose from and to show baseline and target */
      planGoals: goals.map(({ progress, measurementConfig, ...g }) => ({
        ...g,
        measurementConfig: storedConfig(measurementConfig),
        latestProgress: progress[0] ?? null,
      })),
      therapist: {
        id: row.therapist.id,
        code: row.therapist.code,
        fullName: row.therapist.fullName,
        designation: row.therapist.designation,
        isYou: isOwn(tenant, row.therapist),
      },
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      completedBy: row.completedBy,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      amendments: row.amendments,
      actions: this.actions(tenant, row),
    };
  }

  /** A note whose content the caller may read, by its session (appointment) ID. */
  private async readable(tenant: TenantContext, appointmentId: string) {
    const row = await this.prisma.sessionNote.findFirst({
      where: { AND: [{ appointmentId }, readableNotes(tenant)] },
      select: noteSelect,
    });
    if (!row) throw noteNotFound();
    return row;
  }

  async get(tenant: TenantContext, appointmentId: string) {
    return this.toDetail(tenant, await this.readable(tenant, appointmentId));
  }

  /** The content before amendment `number`; number 1 holds the signed original. */
  async amendment(
    tenant: TenantContext,
    appointmentId: string,
    number: number,
  ) {
    const row = await this.readable(tenant, appointmentId);
    const amendment = await this.prisma.sessionNoteAmendment.findUnique({
      where: { noteId_number: { noteId: row.id, number } },
      select: {
        number: true,
        reason: true,
        changedFields: true,
        previousContent: true,
        previousRevision: true,
        amendedAt: true,
        amendedBy: userSelect,
      },
    });
    if (!amendment) throw noteNotFound();
    return {
      ...amendment,
      form: storedDefinition(row.templateVersion.definition),
    };
  }

  // ── Writing ───────────────────────────────────────────────────────────────

  /**
   * Opens the session's note: a draft from the chosen template, or the default one for
   * the therapy. Only the session's therapist, from the day of the session, while it
   * hasn't been cancelled, marked a no-show or voided. Starts the session if it hadn't
   * started. Opening a note that exists returns it.
   */
  async create(
    tenant: TenantContext,
    appointmentId: string,
    dto: CreateNoteDto,
    ip: string | null,
  ) {
    const row = await this.lifecycle.load(this.prisma, tenant, appointmentId);
    const existing = await this.prisma.sessionNote.findUnique({
      where: { appointmentId },
      select: { id: true },
    });
    if (existing) return this.get(tenant, appointmentId);
    if (row.type !== AppointmentType.THERAPY_SESSION) throw notTherapySession();
    if (!isOwn(tenant, row.therapist)) {
      throw notResponsible(row.therapist.fullName);
    }
    if (
      row.status === AppointmentStatus.CANCELLED ||
      row.status === AppointmentStatus.NO_SHOW ||
      row.session?.status === TherapySessionStatus.VOIDED
    ) {
      throw apiError(
        HttpStatus.CONFLICT,
        'This session didn’t take place, so it has no note.',
        'SESSION_NOT_DOCUMENTABLE',
      );
    }
    const { now, today, timeZone } = await this.lifecycle.center(tenant);
    if (localTimes(row.startAt, row.endAt, timeZone).date > today) {
      throw apiError(
        HttpStatus.CONFLICT,
        'A session’s note can be written from the day of the session.',
        'APPOINTMENT_NOT_DUE',
      );
    }
    const form = await this.templates.formForNote(
      tenant,
      row.therapyTypeId,
      dto.templateId,
      ip,
    );
    try {
      await this.prisma.$transaction(async (tx) => {
        const session = await this.lifecycle.ensureSession(
          tx,
          tenant,
          row,
          now,
        );
        if (!session) throw noteChanged();
        const note = await tx.sessionNote.create({
          data: {
            centerId: tenant.centerId,
            appointmentId,
            templateVersionId: form.versionId,
            therapistId: row.therapistId,
            therapyPlanId: session.therapyPlanId,
            answers: defaultAnswers(form.definition),
            createdById: tenant.userId,
          },
          select: { id: true },
        });
        await this.audit.record(
          {
            centerId: tenant.centerId,
            actorUserId: tenant.userId,
            action: 'session_note.created',
            entityType: 'SessionNote',
            entityId: note.id,
            metadata: {
              patientCode: row.patient.code,
              appointmentId,
              templateVersionId: form.versionId,
            },
            ipAddress: ip,
          },
          tx,
        );
      });
    } catch (error) {
      // Opened by another request at the same moment: use that note.
      if (!isUniqueViolation(error)) throw error;
    }
    return this.get(tenant, appointmentId);
  }

  /** Loads a note for a write by its own therapist, else the right error. */
  private async forWrite(
    tenant: TenantContext,
    appointmentId: string,
    revision: number,
    want: 'draft' | 'signed',
  ) {
    const row = await this.prisma.sessionNote.findFirst({
      where: { appointmentId, centerId: tenant.centerId },
      select: noteSelect,
    });
    if (!row || !isOwn(tenant, row.therapist)) {
      // Others who may read it are told why they can't change it.
      const visible =
        row &&
        (await this.prisma.sessionNote.count({
          where: { AND: [{ id: row.id }, readableNotes(tenant)] },
        }));
      if (row && visible) throw notResponsible(row.therapist.fullName);
      throw noteNotFound();
    }
    const draft = row.status === SessionNoteStatus.DRAFT;
    if (want === 'draft' && !draft) {
      throw apiError(
        HttpStatus.CONFLICT,
        'This note is completed, so it can’t be edited. Amend it instead.',
        'NOTE_COMPLETED',
      );
    }
    if (want === 'signed' && draft) {
      throw apiError(
        HttpStatus.CONFLICT,
        'This note is still a draft. Edit it directly.',
        'NOTE_DRAFT',
      );
    }
    if (want === 'draft' && !this.actions(tenant, row).edit) {
      throw apiError(
        HttpStatus.CONFLICT,
        'This session didn’t take place, so its note can only be discarded.',
        'SESSION_NOT_DOCUMENTABLE',
      );
    }
    if (row.revision !== revision) throw noteChanged();
    return row;
  }

  /**
   * Checks goal entries against the note's plan: each goal once, of that plan (so of
   * this patient and center), with a value its measurement allows. Signing off also
   * needs something recorded for each goal listed. `recorded` are goals the note already
   * recorded progress for, which may stay even if since discontinued.
   */
  private checkGoals(
    entries: GoalEntryDto[] | GoalEntry[],
    goals: PlanGoal[],
    errors: Errors,
    {
      complete,
      recorded = new Set<string>(),
    }: { complete: boolean; recorded?: Set<string> },
  ): GoalEntry[] {
    const byId = new Map(goals.map((g) => [g.id, g]));
    const seen = new Set<string>();
    return entries.flatMap((e, i) => {
      const path = `goals.${i}`;
      const goal = byId.get(e.goalId);
      if (!goal) {
        errors[`${path}.goalId`] =
          'This goal isn’t part of the patient’s therapy plan for this session';
        return [];
      }
      if (seen.has(goal.id)) {
        errors[`${path}.goalId`] = 'This goal is listed twice';
        return [];
      }
      seen.add(goal.id);
      if (
        goal.status === TherapyGoalStatus.DISCONTINUED &&
        !recorded.has(goal.id)
      ) {
        errors[`${path}.goalId`] = 'This goal is discontinued';
      }
      const entry: GoalEntry = {
        goalId: goal.id,
        observation: e.observation ?? null,
        measuredValue: e.measuredValue ?? null,
        goalStatus: e.goalStatus ?? null,
      };
      const problem = valueError(
        goal.measurementType,
        storedConfig(goal.measurementConfig),
        entry.measuredValue,
      );
      if (problem) errors[`${path}.measuredValue`] = problem;
      if (
        complete &&
        entry.measuredValue === null &&
        !entry.observation &&
        !entry.goalStatus
      ) {
        errors[`${path}.observation`] =
          'Record a value, an observation or a status, or remove the goal';
      }
      return [entry];
    });
  }

  /** The content after applying a change; each part sent replaces the current one. */
  private async merge(
    tenant: TenantContext,
    row: NoteRow,
    dto: UpdateNoteDto,
    { complete }: { complete: boolean },
  ): Promise<NoteContent> {
    const definition = storedDefinition(row.templateVersion.definition);
    const errors: Errors = {};
    const checked = validateAnswers(definition, dto.answers ?? row.answers, {
      complete,
    });
    Object.assign(errors, checked.errors);
    const current = this.goalsOf(row);
    const input = dto.goals ?? current;
    let goals: GoalEntry[] = [];
    if (input.length && !row.therapyPlanId) {
      errors.goals =
        'This patient has no active therapy plan for this therapy, so there are no goals to record.';
    } else if (input.length) {
      goals = this.checkGoals(
        input,
        await this.planGoals(row.therapyPlanId),
        errors,
        {
          complete,
          recorded: new Set(
            row.status === SessionNoteStatus.DRAFT
              ? []
              : current.map((g) => g.goalId),
          ),
        },
      );
      const { timeZone } = await this.lifecycle.center(tenant);
      const appointment = row.session.appointment;
      const date = localTimes(
        appointment.startAt,
        appointment.endAt,
        timeZone,
      ).date;
      if (
        complete &&
        row.therapyPlan &&
        parseIsoDate(date)! < row.therapyPlan.startDate
      ) {
        errors.goals =
          'Progress can’t be recorded for a session before the therapy plan started.';
      }
    }
    if (Object.keys(errors).length) {
      throw invalid(
        errors,
        complete
          ? 'Some required information is missing. Check the highlighted fields.'
          : undefined,
      );
    }
    return { answers: checked.answers, goals };
  }

  /**
   * Locks the note's plan and checks it's active: progress is only recorded against
   * active plans (therapy-plans/rules.ts WORK_STATUSES.recordProgress).
   */
  private async lockActivePlan(tx: Tx, tenant: TenantContext, planId: string) {
    await tx.$queryRaw`
      SELECT id FROM "TherapyPlan"
      WHERE id = ${planId}::uuid AND "centerId" = ${tenant.centerId}::uuid
      FOR UPDATE`;
    const plan = await tx.therapyPlan.findUniqueOrThrow({
      where: { id: planId },
      select: { status: true },
    });
    if (plan.status !== TherapyPlanStatus.ACTIVE) {
      throw apiError(
        HttpStatus.CONFLICT,
        plan.status === TherapyPlanStatus.PAUSED
          ? 'The therapy plan is paused, so goal progress can’t be recorded. Remove the goals from the note, or resume the plan first.'
          : 'The therapy plan is closed, so goal progress can’t be recorded or changed.',
        'PLAN_NOT_ACTIVE',
      );
    }
  }

  /** One progress entry for the note, or a correction of its earlier one. */
  private async recordProgress(
    tx: Tx,
    tenant: TenantContext,
    row: NoteRow,
    entry: GoalEntry,
    goalStatus: TherapyGoalStatus,
    observationDate: Date,
    correction?: { correctsId: string; reason: string },
  ) {
    await tx.therapyGoalProgress.create({
      data: {
        centerId: tenant.centerId,
        therapyPlanId: row.therapyPlanId!,
        goalId: entry.goalId,
        observationDate,
        goalStatus: entry.goalStatus,
        measuredValue: entry.measuredValue,
        observation: entry.observation,
        sessionNoteId: row.id,
        correctsId: correction?.correctsId ?? null,
        correctionReason: correction?.reason ?? null,
        recordedById: tenant.userId,
      },
    });
    // The therapist's own judgement, as when progress is recorded on the plan.
    if (entry.goalStatus && entry.goalStatus !== goalStatus) {
      await tx.therapyPlanGoal.update({
        where: { id: entry.goalId },
        data: {
          status: entry.goalStatus,
          statusChangedAt: new Date(),
          statusChangedById: tenant.userId,
        },
      });
    }
  }

  /** Writes that may race on the note's revision or its progress entries, as a clean 409. */
  private async write<T>(fn: (tx: Tx) => Promise<T>) {
    try {
      return await this.prisma.$transaction(fn);
    } catch (error) {
      if (isUniqueViolation(error)) throw noteChanged();
      throw error;
    }
  }

  async update(
    tenant: TenantContext,
    appointmentId: string,
    dto: UpdateNoteDto,
  ) {
    const row = await this.forWrite(
      tenant,
      appointmentId,
      dto.revision,
      'draft',
    );
    const content = await this.merge(tenant, row, dto, { complete: false });
    await this.write(async (tx) => {
      const { count } = await tx.sessionNote.updateMany({
        where: {
          id: row.id,
          revision: row.revision,
          status: SessionNoteStatus.DRAFT,
        },
        data: {
          answers: content.answers,
          draftGoals: content.goals as unknown as Prisma.InputJsonValue,
          revision: { increment: 1 },
          updatedById: tenant.userId,
        },
      });
      if (!count) throw noteChanged();
    });
    return this.get(tenant, appointmentId);
  }

  /**
   * Saves what's sent and signs the note off: every required field answered, something
   * recorded for each goal listed, the session started. Its goal progress is written to
   * the plan in the same transaction. The note is then read-only; completing the
   * session itself is a separate step (either can come first).
   */
  async complete(
    tenant: TenantContext,
    appointmentId: string,
    dto: CompleteNoteDto,
    ip: string | null,
  ) {
    const row = await this.forWrite(
      tenant,
      appointmentId,
      dto.revision,
      'draft',
    );
    const appointment = row.session.appointment;
    const { now, timeZone } = await this.lifecycle.center(tenant);
    if (appointment.startAt > now) {
      throw apiError(
        HttpStatus.CONFLICT,
        'A note can be signed off once the session has started.',
        'APPOINTMENT_NOT_STARTED',
      );
    }
    const content = await this.merge(tenant, row, dto, { complete: true });
    const date = parseIsoDate(
      localTimes(appointment.startAt, appointment.endAt, timeZone).date,
    )!;
    const goals = new Map(
      (await this.planGoals(row.therapyPlanId)).map((g) => [g.id, g.status]),
    );
    await this.write(async (tx) => {
      if (content.goals.length) {
        await this.lockActivePlan(tx, tenant, row.therapyPlanId!);
      }
      const { count } = await tx.sessionNote.updateMany({
        where: {
          id: row.id,
          revision: row.revision,
          status: SessionNoteStatus.DRAFT,
        },
        data: {
          answers: content.answers,
          draftGoals: [],
          status: SessionNoteStatus.COMPLETED,
          completedAt: now,
          completedById: tenant.userId,
          revision: { increment: 1 },
          updatedById: tenant.userId,
        },
      });
      if (!count) throw noteChanged();
      for (const entry of content.goals) {
        await this.recordProgress(
          tx,
          tenant,
          row,
          entry,
          goals.get(entry.goalId)!,
          date,
        );
      }
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'session_note.completed',
          entityType: 'SessionNote',
          entityId: row.id,
          metadata: {
            patientCode: appointment.patient.code,
            appointmentId,
            templateVersionId: row.templateVersion.id,
            goalsRecorded: content.goals.length,
          },
          ipAddress: ip,
        },
        tx,
      );
    });
    return this.get(tenant, appointmentId);
  }

  /**
   * Corrects a completed note. The content before the correction is kept in a new
   * SessionNoteAmendment with who, when, why and what changed (labels only). Changed
   * goal progress becomes a correction of the note's earlier entry (kept, marked as
   * corrected); recorded progress can't be removed, only corrected.
   */
  async amend(
    tenant: TenantContext,
    appointmentId: string,
    dto: AmendNoteDto,
    ip: string | null,
  ) {
    const row = await this.forWrite(
      tenant,
      appointmentId,
      dto.revision,
      'signed',
    );
    const before = this.goalsOf(row);
    const after = await this.merge(tenant, row, dto, { complete: true });
    const removed = before.findIndex(
      (b) => !after.goals.some((g) => g.goalId === b.goalId),
    );
    if (removed >= 0) {
      throw invalid({
        goals:
          'Recorded progress can’t be removed from a completed note. Correct it instead.',
      });
    }
    const goals = await this.planGoals(row.therapyPlanId);
    const titles = new Map(goals.map((g) => [g.id, g]));
    const goalChanges = after.goals.filter((g) => {
      const b = before.find((x) => x.goalId === g.goalId);
      return !b || !sameEntry(b, g);
    });
    const changed = [
      ...changedAnswerLabels(
        storedDefinition(row.templateVersion.definition),
        row.answers as Answers,
        after.answers,
      ),
      ...goalChanges.map((g) => `Goal: ${titles.get(g.goalId)?.title ?? ''}`),
    ];
    if (!changed.length) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'Nothing has changed. Make the correction, then save the amendment.',
        'NOTHING_CHANGED',
      );
    }
    const { timeZone } = await this.lifecycle.center(tenant);
    const appointment = row.session.appointment;
    const date = parseIsoDate(
      localTimes(appointment.startAt, appointment.endAt, timeZone).date,
    )!;
    await this.write(async (tx) => {
      if (goalChanges.length) {
        await this.lockActivePlan(tx, tenant, row.therapyPlanId!);
      }
      const { count } = await tx.sessionNote.updateMany({
        where: {
          id: row.id,
          revision: row.revision,
          status: {
            in: [SessionNoteStatus.COMPLETED, SessionNoteStatus.AMENDED],
          },
        },
        data: {
          answers: after.answers,
          status: SessionNoteStatus.AMENDED,
          revision: { increment: 1 },
          updatedById: tenant.userId,
        },
      });
      if (!count) throw noteChanged();
      for (const entry of goalChanges) {
        const earlier = before.find((b) => b.goalId === entry.goalId);
        await this.recordProgress(
          tx,
          tenant,
          row,
          entry,
          titles.get(entry.goalId)!.status,
          date,
          earlier?.progressId
            ? { correctsId: earlier.progressId, reason: dto.reason }
            : undefined,
        );
      }
      const number = row.amendments.length + 1;
      await tx.sessionNoteAmendment.create({
        data: {
          centerId: tenant.centerId,
          noteId: row.id,
          number,
          reason: dto.reason,
          changedFields: changed,
          previousContent: {
            answers: row.answers,
            goals: before.map((g) => ({
              goalId: g.goalId,
              observation: g.observation,
              measuredValue: g.measuredValue,
              goalStatus: g.goalStatus,
            })),
          },
          previousRevision: row.revision,
          amendedById: tenant.userId,
        },
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'session_note.amended',
          entityType: 'SessionNote',
          entityId: row.id,
          // Field labels come from the center's template; goals only as a count.
          metadata: {
            patientCode: appointment.patient.code,
            amendment: number,
            changedFields: changed.filter((c) => !c.startsWith('Goal: ')),
            goalsChanged: goalChanges.length,
          },
          ipAddress: ip,
        },
        tx,
      );
    });
    return this.get(tenant, appointmentId);
  }

  /** Throws a draft away. Completed notes are kept (and the database insists). */
  async discard(
    tenant: TenantContext,
    appointmentId: string,
    ip: string | null,
  ) {
    const row = await this.prisma.sessionNote.findFirst({
      where: { appointmentId, centerId: tenant.centerId },
      select: noteSelect,
    });
    if (!row || !isOwn(tenant, row.therapist)) throw noteNotFound();
    if (row.status !== SessionNoteStatus.DRAFT) {
      throw apiError(
        HttpStatus.CONFLICT,
        'Completed notes are part of the clinical record and can’t be deleted.',
        'NOTE_COMPLETED',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.sessionNote.deleteMany({
        where: { id: row.id, status: SessionNoteStatus.DRAFT },
      });
      if (!removed.count) throw noteChanged();
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'session_note.discarded',
          entityType: 'SessionNote',
          entityId: row.id,
          metadata: {
            patientCode: row.session.appointment.patient.code,
            appointmentId,
          },
          ipAddress: ip,
        },
        tx,
      );
    });
  }
}
