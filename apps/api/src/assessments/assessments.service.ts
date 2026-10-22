import { HttpStatus, Injectable } from '@nestjs/common';

import { visibleAppointments } from '../appointments/access';
import { localTimes } from '../appointments/appointments.service';
import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { isUniqueViolation } from '../centers/centers.service';
import { apiError } from '../common/errors';
import { addDays, formatIsoDate, parseIsoDate, todayIn } from '../common/time';
import type { Prisma } from '../generated/prisma/client';
import {
  AppointmentStatus,
  AppointmentType,
  AssessmentStatus,
  AssessmentTemplateStatus,
  MembershipStatus,
  TherapistStatus,
  type AssessmentType,
  type GoalPriority,
} from '../generated/prisma/enums';
import { assertCan } from '../patients/access';
import { patientAge } from '../patients/age';
import { fieldError } from '../patients/contacts';
import { PrismaService } from '../prisma/prisma.service';
import { visibleTherapists } from '../therapists/access';
import {
  assessablePatients,
  assessmentNotFound,
  isOwn,
  listableAssessments,
  readableAssessments,
} from './access';
import type {
  AmendAssessmentDto,
  AssessmentContentDto,
  CompleteAssessmentDto,
  CreateAssessmentDto,
  ListAssessmentsQuery,
  PatientOptionsQuery,
  UpdateAssessmentDto,
} from './dto';
import {
  changedAnswerLabels,
  defaultAnswers,
  validateAnswers,
  type Answers,
  type Errors,
  type TemplateDefinition,
} from './engine';
import { storedDefinition } from './templates.service';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;

const userSelect = { select: { id: true, fullName: true } } as const;
const therapyTypeSelect = {
  select: { id: true, name: true, code: true, color: true },
} as const;

const itemSelect = {
  id: true,
  type: true,
  status: true,
  assessmentDate: true,
  appointmentId: true,
  revision: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  patient: {
    select: {
      id: true,
      code: true,
      fullName: true,
      photoUrl: true,
      deletedAt: true,
    },
  },
  therapist: {
    select: {
      id: true,
      code: true,
      fullName: true,
      membershipId: true,
      deletedAt: true,
    },
  },
  therapyType: therapyTypeSelect,
  templateVersion: {
    select: {
      id: true,
      version: true,
      template: { select: { id: true, name: true } },
    },
  },
  completedBy: userSelect,
  _count: { select: { amendments: true } },
} satisfies Prisma.AssessmentSelect;

const detailSelect = {
  ...itemSelect,
  answers: true,
  summary: true,
  keyFindings: true,
  strengths: true,
  areasOfDifficulty: true,
  clinicalImpression: true,
  followUpRecommendation: true,
  additionalRecommendations: true,
  suggestedReviewDate: true,
  patient: {
    select: {
      ...itemSelect.patient.select,
      gender: true,
      dateOfBirth: true,
      approxAgeMonths: true,
      approxAgeAsOf: true,
      primaryConcern: true,
      referralSource: true,
      referralOther: true,
    },
  },
  therapist: {
    select: {
      ...itemSelect.therapist.select,
      designation: true,
      qualifications: true,
      registrationNumber: true,
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
  appointment: {
    select: { id: true, startAt: true, endAt: true, status: true, type: true },
  },
  recommendations: {
    select: {
      sessionsPerWeek: true,
      durationMinutes: true,
      reviewAfterWeeks: true,
      note: true,
      therapyType: therapyTypeSelect,
    },
    orderBy: { displayOrder: 'asc' },
  },
  goals: {
    select: {
      title: true,
      description: true,
      priority: true,
      targetReviewDate: true,
    },
    orderBy: { displayOrder: 'asc' },
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
  createdBy: userSelect,
  updatedBy: userSelect,
} satisfies Prisma.AssessmentSelect;

type ItemRow = Prisma.AssessmentGetPayload<{ select: typeof itemSelect }>;
type DetailRow = Prisma.AssessmentGetPayload<{ select: typeof detailSelect }>;

/** The common clinical summary, kept as columns. Labels name them in amendments. */
const SUMMARY_FIELDS = {
  summary: 'Assessment summary',
  keyFindings: 'Key findings',
  strengths: 'Strengths',
  areasOfDifficulty: 'Areas of difficulty',
  clinicalImpression: 'Clinical impression',
  followUpRecommendation: 'Follow-up recommendation',
  additionalRecommendations: 'Additional recommendations',
} as const;
type SummaryText = keyof typeof SUMMARY_FIELDS;
const SUMMARY_KEYS = Object.keys(SUMMARY_FIELDS) as SummaryText[];

export type ClinicalSummary = Record<SummaryText, string | null> & {
  suggestedReviewDate: string | null;
};

export interface Recommendation {
  therapyType: { id: string; name: string; code: string; color: string | null };
  sessionsPerWeek: number | null;
  durationMinutes: number | null;
  reviewAfterWeeks: number | null;
  note: string | null;
}

export interface Goal {
  title: string;
  description: string | null;
  priority: GoalPriority | null;
  targetReviewDate: string | null;
}

/**
 * Everything clinical about an assessment, as stored on the row and its child rows,
 * and as snapshotted in an amendment's previousContent.
 */
export interface AssessmentContent {
  type: AssessmentType;
  assessmentDate: string;
  answers: Answers;
  clinicalSummary: ClinicalSummary;
  recommendations: Recommendation[];
  goals: Goal[];
}

const TYPE_LABELS: Record<AssessmentType, string> = {
  INITIAL: 'initial assessment',
  FOLLOW_UP: 'follow-up assessment',
  REASSESSMENT: 'reassessment',
};

function contentOf(row: DetailRow): AssessmentContent {
  return {
    type: row.type,
    assessmentDate: formatIsoDate(row.assessmentDate),
    answers: row.answers as Answers,
    clinicalSummary: {
      ...(Object.fromEntries(SUMMARY_KEYS.map((k) => [k, row[k]])) as Record<
        SummaryText,
        string | null
      >),
      suggestedReviewDate: row.suggestedReviewDate
        ? formatIsoDate(row.suggestedReviewDate)
        : null,
    },
    recommendations: row.recommendations,
    goals: row.goals.map((g) => ({
      ...g,
      targetReviewDate: g.targetReviewDate
        ? formatIsoDate(g.targetReviewDate)
        : null,
    })),
  };
}

/** Labels of what differs between two versions of the content, for amendments. */
function changedLabels(
  definition: TemplateDefinition,
  before: AssessmentContent,
  after: AssessmentContent,
) {
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  return [
    ...(before.type !== after.type ? ['Assessment type'] : []),
    ...(before.assessmentDate !== after.assessmentDate
      ? ['Assessment date']
      : []),
    ...changedAnswerLabels(definition, before.answers, after.answers),
    ...SUMMARY_KEYS.filter(
      (k) => before.clinicalSummary[k] !== after.clinicalSummary[k],
    ).map((k) => SUMMARY_FIELDS[k]),
    ...(before.clinicalSummary.suggestedReviewDate !==
    after.clinicalSummary.suggestedReviewDate
      ? ['Suggested review date']
      : []),
    ...(!same(before.recommendations, after.recommendations)
      ? ['Recommendations']
      : []),
    ...(!same(before.goals, after.goals) ? ['Initial goals'] : []),
  ];
}

const changedMeanwhile = () =>
  apiError(
    HttpStatus.CONFLICT,
    'This assessment was changed in another tab or by someone else. Reload to see the latest version.',
    'ASSESSMENT_CHANGED',
  );

const notYours = (therapist: string) =>
  apiError(
    HttpStatus.FORBIDDEN,
    `Only ${therapist}, the responsible therapist, can change this assessment.`,
    'NOT_RESPONSIBLE_THERAPIST',
  );

const notDraft = () =>
  apiError(
    HttpStatus.CONFLICT,
    'This assessment is completed, so it can’t be edited. Amend it instead.',
    'ASSESSMENT_COMPLETED',
  );

const invalid = (
  errors: Errors,
  message = 'Please check the highlighted fields',
) => apiError(HttpStatus.BAD_REQUEST, message, 'VALIDATION_FAILED', errors);

/**
 * Assessments: creating one from a published template, saving drafts, completing
 * (signing) and amending, and the history lists. Clinical content is only ever written
 * by the assessment's own therapist; see access.ts for who can read what.
 */
@Injectable()
export class AssessmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async center(tenant: TenantContext) {
    const center = await this.prisma.center.findUniqueOrThrow({
      where: { id: tenant.centerId },
      select: { timezone: true },
    });
    return { timeZone: center.timezone, today: todayIn(center.timezone) };
  }

  private date(value: string, field: string) {
    const date = parseIsoDate(value);
    if (!date)
      throw fieldError(field, 'Choose a valid date', 'VALIDATION_FAILED');
    return date;
  }

  // ── Presenting ────────────────────────────────────────────────────────────

  /**
   * What the caller may do with an assessment now, so every screen offers the same
   * actions. The API still checks each request.
   */
  private actions(
    tenant: TenantContext,
    row: Pick<ItemRow, 'status' | 'therapist'>,
    readable: boolean,
  ) {
    const own = isOwn(tenant, row.therapist);
    const can = (p: Parameters<typeof assertCan>[1]) =>
      tenant.permissions.includes(p);
    const draft = row.status === AssessmentStatus.DRAFT;
    return {
      /** Open the clinical content (and print it) */
      view: readable,
      edit: own && draft && can('assessments.update_draft'),
      complete: own && draft && can('assessments.complete'),
      amend: own && !draft && can('assessments.amend'),
      discard: own && draft && can('assessments.update_draft'),
    };
  }

  private toItem(tenant: TenantContext, row: ItemRow, readable: boolean) {
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      assessmentDate: formatIsoDate(row.assessmentDate),
      appointmentId: row.appointmentId,
      revision: row.revision,
      patient: {
        id: row.patient.id,
        code: row.patient.code,
        fullName: row.patient.fullName,
        photoUrl: row.patient.photoUrl,
        isDeleted: row.patient.deletedAt !== null,
      },
      therapist: {
        id: row.therapist.id,
        code: row.therapist.code,
        fullName: row.therapist.fullName,
        isDeleted: row.therapist.deletedAt !== null,
        isYou: isOwn(tenant, row.therapist),
      },
      therapyType: row.therapyType,
      template: {
        id: row.templateVersion.template.id,
        name: row.templateVersion.template.name,
        versionId: row.templateVersion.id,
        version: row.templateVersion.version,
      },
      completedAt: row.completedAt,
      completedBy: row.completedBy,
      amendmentCount: row._count.amendments,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      actions: this.actions(tenant, row, readable),
    };
  }

  /** IDs among `ids` whose content the caller may read. */
  private async readableIds(tenant: TenantContext, ids: string[]) {
    if (tenant.permissions.includes('assessments.read') || !ids.length) {
      return new Set(ids);
    }
    const rows = await this.prisma.assessment.findMany({
      where: { AND: [readableAssessments(tenant), { id: { in: ids } }] },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  private toDetail(
    tenant: TenantContext,
    row: DetailRow,
    readable: boolean,
    timeZone: string,
  ) {
    const item = this.toItem(tenant, row, readable);
    const p = row.patient;
    const appointment = row.appointment && {
      id: row.appointment.id,
      status: row.appointment.status,
      ...localTimes(row.appointment.startAt, row.appointment.endAt, timeZone),
    };
    if (!readable) {
      return {
        ...item,
        clinicalAccess: false as const,
        appointment,
        form: null,
        content: null,
        amendments: [],
        createdBy: row.createdBy,
        updatedBy: null,
      };
    }
    const { clinicalSummary, recommendations, goals, answers } = contentOf(row);
    return {
      ...item,
      clinicalAccess: true as const,
      patient: {
        ...item.patient,
        gender: p.gender,
        /** At the assessment date, from the date of birth or an approximate age */
        ageAtAssessment: patientAge(p, row.assessmentDate),
        primaryConcern: p.primaryConcern,
        referralSource: p.referralSource,
        referralOther: p.referralOther,
      },
      therapist: {
        ...item.therapist,
        designation: row.therapist.designation,
        qualifications: row.therapist.qualifications,
        registrationNumber: row.therapist.registrationNumber,
      },
      template: {
        ...item.template,
        description: row.templateVersion.template.description,
        versionStatus: row.templateVersion.status,
      },
      appointment,
      form: storedDefinition(row.templateVersion.definition),
      content: { answers, clinicalSummary, recommendations, goals },
      amendments: row.amendments,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
    };
  }

  private async detail(tenant: TenantContext, id: string) {
    const row = await this.prisma.assessment.findFirst({
      where: { id, ...listableAssessments(tenant) },
      select: detailSelect,
    });
    if (!row) throw assessmentNotFound();
    const readable = (await this.readableIds(tenant, [id])).has(id);
    const { timeZone } = await this.center(tenant);
    return { row, readable, timeZone };
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  async list(tenant: TenantContext, query: ListAssessmentsQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search;
    const from = query.from ? this.date(query.from, 'from') : null;
    const to = query.to ? this.date(query.to, 'to') : null;
    const where: Prisma.AssessmentWhereInput = {
      AND: [
        listableAssessments(tenant),
        {
          ...(query.patientId && { patientId: query.patientId }),
          ...(query.therapyTypeId && { therapyTypeId: query.therapyTypeId }),
          ...(query.therapistId && { therapistId: query.therapistId }),
          ...(query.type && { type: query.type }),
          ...(query.status?.length && { status: { in: query.status } }),
          ...((from || to) && {
            assessmentDate: {
              ...(from && { gte: from }),
              ...(to && { lte: to }),
            },
          }),
        },
        search
          ? {
              OR: [
                {
                  patient: {
                    fullName: { contains: search, mode: 'insensitive' },
                  },
                },
                {
                  patient: { code: { contains: search, mode: 'insensitive' } },
                },
                {
                  therapist: {
                    fullName: { contains: search, mode: 'insensitive' },
                  },
                },
              ],
            }
          : {},
      ],
    };
    const order = query.sortOrder ?? 'desc';
    const [total, rows] = await Promise.all([
      this.prisma.assessment.count({ where }),
      this.prisma.assessment.findMany({
        where,
        select: itemSelect,
        orderBy: [
          { assessmentDate: order },
          { createdAt: order },
          { id: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const readable = await this.readableIds(
      tenant,
      rows.map((r) => r.id),
    );
    return {
      items: rows.map((r) => this.toItem(tenant, r, readable.has(r.id))),
      total,
      page,
      pageSize,
    };
  }

  /** One patient's assessments, newest first: their clinical history. */
  async patientHistory(tenant: TenantContext, patientId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, ...assessablePatients(tenant) },
      select: { id: true, code: true, fullName: true },
    });
    if (!patient) {
      throw apiError(HttpStatus.NOT_FOUND, 'Patient not found', 'NOT_FOUND');
    }
    const rows = await this.prisma.assessment.findMany({
      where: { AND: [listableAssessments(tenant), { patientId }] },
      select: itemSelect,
      orderBy: [{ assessmentDate: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    const readable = await this.readableIds(
      tenant,
      rows.map((r) => r.id),
    );
    return {
      patient,
      items: rows.map((r) => this.toItem(tenant, r, readable.has(r.id))),
    };
  }

  /** Patients the caller may start an assessment for, by name or ID. */
  async patientOptions(tenant: TenantContext, query: PatientOptionsQuery) {
    const search = query.search;
    const { today } = await this.center(tenant);
    const rows = await this.prisma.patient.findMany({
      where: {
        AND: [
          assessablePatients(tenant),
          search
            ? {
                OR: [
                  { fullName: { contains: search, mode: 'insensitive' } },
                  { code: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {},
        ],
      },
      select: {
        id: true,
        code: true,
        fullName: true,
        photoUrl: true,
        status: true,
        gender: true,
        dateOfBirth: true,
        approxAgeMonths: true,
        approxAgeAsOf: true,
      },
      orderBy: [{ fullName: 'asc' }, { code: 'asc' }],
      take: 20,
    });
    return {
      items: rows.map((p) => ({
        id: p.id,
        code: p.code,
        fullName: p.fullName,
        photoUrl: p.photoUrl,
        status: p.status,
        gender: p.gender,
        age: patientAge(p, today),
      })),
    };
  }

  async get(tenant: TenantContext, id: string) {
    const { row, readable, timeZone } = await this.detail(tenant, id);
    return this.toDetail(tenant, row, readable, timeZone);
  }

  /** The content as it was before an amendment; the first one is the signed original. */
  async amendment(tenant: TenantContext, id: string, number: number) {
    const row = await this.prisma.assessment.findFirst({
      where: { id, ...readableAssessments(tenant) },
      select: {
        templateVersion: { select: { definition: true } },
        amendments: {
          where: { number },
          select: {
            number: true,
            reason: true,
            changedFields: true,
            previousContent: true,
            previousRevision: true,
            amendedAt: true,
            amendedBy: userSelect,
          },
        },
      },
    });
    const amendment = row?.amendments[0];
    if (!row || !amendment) throw assessmentNotFound();
    return {
      ...amendment,
      form: storedDefinition(row.templateVersion.definition),
    };
  }

  // ── Creating ──────────────────────────────────────────────────────────────

  private async therapyType(tx: Db, tenant: TenantContext, id: string) {
    const type = await tx.therapyType.findFirst({
      where: { id, centerId: tenant.centerId },
      select: { id: true, name: true, isActive: true },
    });
    if (!type) {
      throw fieldError(
        'therapyTypeId',
        'This therapy no longer exists. Reload and try again.',
        'THERAPY_TYPE_NOT_FOUND',
      );
    }
    if (!type.isActive) {
      throw fieldError(
        'therapyTypeId',
        `${type.name} is inactive. Activate it in Settings first.`,
        'THERAPY_TYPE_INACTIVE',
      );
    }
    return type;
  }

  /** The published version of a usable template for this therapy and type. */
  private async templateVersion(
    tx: Db,
    tenant: TenantContext,
    dto: CreateAssessmentDto,
  ) {
    const template = await tx.assessmentTemplate.findFirst({
      where: { id: dto.templateId, centerId: tenant.centerId },
      select: {
        id: true,
        name: true,
        status: true,
        purpose: true,
        therapyTypeId: true,
        publishedVersion: {
          select: { id: true, version: true, definition: true },
        },
      },
    });
    const fail = (message: string, code: string) =>
      fieldError('templateId', message, code);
    if (!template) {
      throw fail(
        'This template no longer exists. Choose another.',
        'TEMPLATE_NOT_FOUND',
      );
    }
    if (template.status === AssessmentTemplateStatus.ARCHIVED) {
      throw fail(
        `${template.name} is archived. Choose another template.`,
        'TEMPLATE_ARCHIVED',
      );
    }
    if (!template.publishedVersion) {
      throw fail(
        `${template.name} isn’t published yet.`,
        'TEMPLATE_NOT_PUBLISHED',
      );
    }
    if (template.therapyTypeId !== dto.therapyTypeId) {
      throw fail(
        'This template is for another therapy.',
        'TEMPLATE_THERAPY_MISMATCH',
      );
    }
    if (template.purpose && template.purpose !== dto.type) {
      throw fail(
        `${template.name} is for a ${TYPE_LABELS[template.purpose]}.`,
        'TEMPLATE_PURPOSE_MISMATCH',
      );
    }
    return template.publishedVersion;
  }

  /**
   * An active therapist the caller may see, who provides the therapy and signs in with a
   * staff account of this center (assessments are signed by their therapist).
   */
  private async therapist(
    tx: Db,
    tenant: TenantContext,
    id: string,
    therapyTypeId: string,
  ) {
    const therapist = await tx.therapist.findFirst({
      where: { id, ...visibleTherapists(tenant) },
      select: {
        id: true,
        fullName: true,
        status: true,
        membership: { select: { status: true } },
        specializations: {
          where: { therapyTypeId },
          select: { id: true },
        },
      },
    });
    const fail = (message: string, code: string) =>
      fieldError('therapistId', message, code);
    if (!therapist) {
      throw fail(
        'This therapist no longer exists. Choose another.',
        'THERAPIST_NOT_FOUND',
      );
    }
    if (therapist.status !== TherapistStatus.ACTIVE) {
      throw fail(`${therapist.fullName} is inactive.`, 'THERAPIST_INACTIVE');
    }
    if (!therapist.specializations.length) {
      throw fail(
        `${therapist.fullName} doesn’t provide this therapy. Choose another therapist.`,
        'THERAPIST_NOT_SPECIALIZED',
      );
    }
    if (therapist.membership?.status !== MembershipStatus.ACTIVE) {
      throw fail(
        `${therapist.fullName} has no active staff account, so they can’t sign assessments. Link one on their profile first.`,
        'THERAPIST_NO_ACCOUNT',
      );
    }
    return therapist;
  }

  private async patient(tx: Db, tenant: TenantContext, id: string) {
    const patient = await tx.patient.findFirst({
      where: { id, ...assessablePatients(tenant) },
      select: { id: true, code: true, fullName: true },
    });
    if (!patient) {
      throw fieldError(
        'patientId',
        'This patient isn’t available. Search again.',
        'PATIENT_NOT_FOUND',
      );
    }
    return patient;
  }

  /**
   * An assessment appointment of the same patient, therapist and therapy that isn't
   * cancelled or missed, and not already recorded by another assessment.
   */
  private async linkableAppointment(
    tx: Db,
    tenant: TenantContext,
    appointmentId: string,
    expect: { patientId: string; therapistId: string; therapyTypeId: string },
    exceptAssessmentId?: string,
  ) {
    const appointment = await tx.appointment.findFirst({
      where: { id: appointmentId, ...visibleAppointments(tenant) },
      select: {
        id: true,
        type: true,
        status: true,
        startAt: true,
        patientId: true,
        therapistId: true,
        therapyTypeId: true,
        assessment: { select: { id: true } },
      },
    });
    const fail = (message: string, code: string) =>
      fieldError('appointmentId', message, code);
    if (!appointment) {
      throw fail('This appointment no longer exists.', 'APPOINTMENT_NOT_FOUND');
    }
    if (appointment.type !== AppointmentType.ASSESSMENT) {
      throw fail(
        'Only assessment appointments can be linked.',
        'NOT_AN_ASSESSMENT_APPOINTMENT',
      );
    }
    if (
      appointment.patientId !== expect.patientId ||
      appointment.therapistId !== expect.therapistId ||
      appointment.therapyTypeId !== expect.therapyTypeId
    ) {
      throw fail(
        'This appointment is for another patient, therapist or therapy.',
        'APPOINTMENT_MISMATCH',
      );
    }
    if (
      appointment.status === AppointmentStatus.CANCELLED ||
      appointment.status === AppointmentStatus.NO_SHOW
    ) {
      throw fail(
        'This appointment was cancelled or missed, so it can’t be linked.',
        'APPOINTMENT_NOT_HELD',
      );
    }
    if (
      appointment.assessment &&
      appointment.assessment.id !== exceptAssessmentId
    ) {
      throw this.alreadyAssessed(appointment.assessment.id);
    }
    return appointment;
  }

  private alreadyAssessed(assessmentId?: string) {
    return apiError(
      HttpStatus.CONFLICT,
      'This appointment already has an assessment. Open that one instead.',
      'APPOINTMENT_ALREADY_ASSESSED',
      { appointmentId: 'This appointment already has an assessment' },
      assessmentId ? { assessmentId } : undefined,
    );
  }

  /** A date for a draft: not absurdly far back or ahead. Completion also needs ≤ today. */
  private assessmentDate(value: string, today: Date, field = 'assessmentDate') {
    const date = this.date(value, field);
    if (date < parseIsoDate('1900-01-01')! || date > addDays(today, 366)) {
      throw fieldError(
        field,
        'Choose a date within the next year',
        'VALIDATION_FAILED',
      );
    }
    return date;
  }

  async create(
    tenant: TenantContext,
    dto: CreateAssessmentDto,
    ip: string | null,
  ) {
    const { today } = await this.center(tenant);
    const assessmentDate = this.assessmentDate(dto.assessmentDate, today);
    const id = await this.write(async (tx) => {
      await this.therapyType(tx, tenant, dto.therapyTypeId);
      const version = await this.templateVersion(tx, tenant, dto);
      const therapist = await this.therapist(
        tx,
        tenant,
        dto.therapistId,
        dto.therapyTypeId,
      );
      const patient = await this.patient(tx, tenant, dto.patientId);
      if (dto.appointmentId) {
        await this.linkableAppointment(tx, tenant, dto.appointmentId, {
          patientId: patient.id,
          therapistId: therapist.id,
          therapyTypeId: dto.therapyTypeId,
        });
      }
      const created = await tx.assessment.create({
        data: {
          centerId: tenant.centerId,
          patientId: patient.id,
          therapistId: therapist.id,
          therapyTypeId: dto.therapyTypeId,
          templateVersionId: version.id,
          appointmentId: dto.appointmentId ?? null,
          type: dto.type,
          assessmentDate,
          answers: defaultAnswers(storedDefinition(version.definition)),
          createdById: tenant.userId,
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'assessment.created',
          entityType: 'Assessment',
          entityId: created.id,
          metadata: {
            patientCode: patient.code,
            therapistId: therapist.id,
            templateVersionId: version.id,
            type: dto.type,
            appointmentId: dto.appointmentId ?? null,
          },
          ipAddress: ip,
        },
        tx,
      );
      return created.id;
    });
    return this.get(tenant, id);
  }

  /** Writes that may race for an appointment's single assessment, as a clean 409. */
  private async write<T>(fn: (tx: Tx) => Promise<T>) {
    try {
      return await this.prisma.$transaction(fn);
    } catch (error) {
      if (isUniqueViolation(error)) throw this.alreadyAssessed();
      throw error;
    }
  }

  // ── Changing ──────────────────────────────────────────────────────────────

  /** Loads an assessment for a write by its own therapist, else the right error. */
  private async forWrite(
    tenant: TenantContext,
    id: string,
    revision: number,
    want: 'draft' | 'completed',
  ) {
    const { row, readable, timeZone } = await this.detail(tenant, id);
    if (!readable) throw assessmentNotFound();
    if (!isOwn(tenant, row.therapist)) throw notYours(row.therapist.fullName);
    const draft = row.status === AssessmentStatus.DRAFT;
    if (want === 'draft' && !draft) throw notDraft();
    if (want === 'completed' && draft) {
      throw apiError(
        HttpStatus.CONFLICT,
        'This assessment is still a draft. Edit it directly.',
        'ASSESSMENT_DRAFT',
      );
    }
    if (row.revision !== revision) throw changedMeanwhile();
    return { row, timeZone };
  }

  /**
   * The content after applying a change: each part that's sent replaces the current
   * one. Checks everything a draft needs; with `complete`, also what signing off needs.
   */
  private async merge(
    tenant: TenantContext,
    row: DetailRow,
    dto: AssessmentContentDto,
    { complete, today }: { complete: boolean; today: Date },
  ): Promise<AssessmentContent> {
    const current = contentOf(row);
    const definition = storedDefinition(row.templateVersion.definition);
    const errors: Errors = {};

    const checked = validateAnswers(
      definition,
      dto.answers ?? current.answers,
      {
        complete,
      },
    );
    Object.assign(errors, checked.errors);

    const assessmentDate = dto.assessmentDate ?? current.assessmentDate;
    const date = parseIsoDate(assessmentDate);
    if (!date) errors.assessmentDate = 'Choose a valid date';
    else if (dto.assessmentDate) {
      try {
        this.assessmentDate(assessmentDate, today);
      } catch {
        errors.assessmentDate = 'Choose a date within the next year';
      }
    }
    if (complete && date && date > today) {
      errors.assessmentDate =
        'An assessment can’t be completed before the date it takes place';
    }

    const summary: ClinicalSummary = dto.clinicalSummary
      ? {
          ...(Object.fromEntries(
            SUMMARY_KEYS.map((k) => [k, dto.clinicalSummary![k] ?? null]),
          ) as Record<SummaryText, string | null>),
          suggestedReviewDate: dto.clinicalSummary.suggestedReviewDate ?? null,
        }
      : current.clinicalSummary;
    if (
      summary.suggestedReviewDate &&
      !parseIsoDate(summary.suggestedReviewDate)
    ) {
      errors['clinicalSummary.suggestedReviewDate'] = 'Choose a valid date';
    }
    if (complete && !summary.summary) {
      errors['clinicalSummary.summary'] =
        'Write an assessment summary to complete the assessment';
    }

    let recommendations = current.recommendations;
    if (dto.recommendations) {
      const ids = [...new Set(dto.recommendations.map((r) => r.therapyTypeId))];
      const types = await this.prisma.therapyType.findMany({
        where: { id: { in: ids }, centerId: tenant.centerId },
        select: {
          id: true,
          name: true,
          code: true,
          color: true,
          isActive: true,
        },
      });
      const already = new Set(
        current.recommendations.map((r) => r.therapyType.id),
      );
      const seen = new Set<string>();
      recommendations = [];
      dto.recommendations.forEach((r, i) => {
        const type = types.find((t) => t.id === r.therapyTypeId);
        const path = `recommendations.${i}.therapyTypeId`;
        if (!type) errors[path] = 'This therapy no longer exists';
        else if (!type.isActive && !already.has(type.id)) {
          errors[path] = `${type.name} is inactive`;
        } else if (seen.has(type.id)) {
          errors[path] = `${type.name} is already recommended above`;
        }
        seen.add(r.therapyTypeId);
        if (!type) return;
        recommendations.push({
          therapyType: {
            id: type.id,
            name: type.name,
            code: type.code,
            color: type.color,
          },
          sessionsPerWeek: r.sessionsPerWeek ?? null,
          durationMinutes: r.durationMinutes ?? null,
          reviewAfterWeeks: r.reviewAfterWeeks ?? null,
          note: r.note ?? null,
        });
      });
    }

    let goals = current.goals;
    if (dto.goals) {
      goals = dto.goals.map((g, i) => {
        if (g.targetReviewDate && !parseIsoDate(g.targetReviewDate)) {
          errors[`goals.${i}.targetReviewDate`] = 'Choose a valid date';
        }
        return {
          title: g.title,
          description: g.description ?? null,
          priority: g.priority ?? null,
          targetReviewDate: g.targetReviewDate ?? null,
        };
      });
    }

    if (Object.keys(errors).length) {
      throw invalid(
        errors,
        complete
          ? 'Some required information is missing. Check the highlighted fields.'
          : undefined,
      );
    }
    return {
      type: dto.type ?? current.type,
      assessmentDate,
      answers: checked.answers,
      clinicalSummary: summary,
      recommendations,
      goals,
    };
  }

  /**
   * Stores new content if the assessment is still at `revision` and in one of
   * `statuses`, else throws. Child rows are replaced in the order given.
   */
  private async store(
    tx: Tx,
    tenant: TenantContext,
    row: DetailRow,
    content: AssessmentContent,
    statuses: AssessmentStatus[],
    extra: Prisma.AssessmentUncheckedUpdateManyInput = {},
  ) {
    const updated = await tx.assessment.updateMany({
      where: {
        id: row.id,
        centerId: tenant.centerId,
        revision: row.revision,
        status: { in: statuses },
      },
      data: {
        type: content.type,
        assessmentDate: parseIsoDate(content.assessmentDate)!,
        answers: content.answers,
        ...Object.fromEntries(
          SUMMARY_KEYS.map((k) => [k, content.clinicalSummary[k]]),
        ),
        suggestedReviewDate: content.clinicalSummary.suggestedReviewDate
          ? parseIsoDate(content.clinicalSummary.suggestedReviewDate)
          : null,
        revision: { increment: 1 },
        updatedById: tenant.userId,
        ...extra,
      },
    });
    if (updated.count === 0) throw changedMeanwhile();
    await tx.assessmentRecommendation.deleteMany({
      where: { assessmentId: row.id },
    });
    if (content.recommendations.length) {
      await tx.assessmentRecommendation.createMany({
        data: content.recommendations.map((r, i) => ({
          assessmentId: row.id,
          therapyTypeId: r.therapyType.id,
          sessionsPerWeek: r.sessionsPerWeek,
          durationMinutes: r.durationMinutes,
          reviewAfterWeeks: r.reviewAfterWeeks,
          note: r.note,
          displayOrder: i,
        })),
      });
    }
    await tx.assessmentGoal.deleteMany({ where: { assessmentId: row.id } });
    if (content.goals.length) {
      await tx.assessmentGoal.createMany({
        data: content.goals.map((g, i) => ({
          assessmentId: row.id,
          title: g.title,
          description: g.description,
          priority: g.priority,
          targetReviewDate: g.targetReviewDate
            ? parseIsoDate(g.targetReviewDate)
            : null,
          displayOrder: i,
        })),
      });
    }
  }

  /** Saves a draft. Required fields may still be empty. */
  async update(tenant: TenantContext, id: string, dto: UpdateAssessmentDto) {
    const { row } = await this.forWrite(tenant, id, dto.revision, 'draft');
    const { today } = await this.center(tenant);
    const content = await this.merge(tenant, row, dto, {
      complete: false,
      today,
    });
    if (dto.appointmentId) {
      await this.linkableAppointment(
        this.prisma,
        tenant,
        dto.appointmentId,
        {
          patientId: row.patient.id,
          therapistId: row.therapist.id,
          therapyTypeId: row.therapyType.id,
        },
        row.id,
      );
    }
    await this.write((tx) =>
      this.store(tx, tenant, row, content, [AssessmentStatus.DRAFT], {
        ...(dto.appointmentId !== undefined && {
          appointmentId: dto.appointmentId,
        }),
      }),
    );
    return this.get(tenant, id);
  }

  /**
   * Saves what's sent and signs the assessment off: every required field answered, a
   * summary written and the date not in the future. Its content is then read-only, and
   * the appointment (if any) isn't touched: attendance is the appointment's own status.
   */
  async complete(
    tenant: TenantContext,
    id: string,
    dto: CompleteAssessmentDto,
    ip: string | null,
  ) {
    const { row } = await this.forWrite(tenant, id, dto.revision, 'draft');
    const { today } = await this.center(tenant);
    const content = await this.merge(tenant, row, dto, {
      complete: true,
      today,
    });
    await this.prisma.$transaction(async (tx) => {
      await this.store(tx, tenant, row, content, [AssessmentStatus.DRAFT], {
        status: AssessmentStatus.COMPLETED,
        completedAt: new Date(),
        completedById: tenant.userId,
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'assessment.completed',
          entityType: 'Assessment',
          entityId: id,
          metadata: {
            patientCode: row.patient.code,
            templateVersionId: row.templateVersion.id,
            appointmentId: row.appointmentId,
          },
          ipAddress: ip,
        },
        tx,
      );
    });
    return this.get(tenant, id);
  }

  /**
   * Corrects a completed assessment. The content before the correction is kept in a new
   * AssessmentAmendment with who, when, why and what changed (labels only), so the
   * signed original and every later version stay readable.
   */
  async amend(
    tenant: TenantContext,
    id: string,
    dto: AmendAssessmentDto,
    ip: string | null,
  ) {
    const { row } = await this.forWrite(tenant, id, dto.revision, 'completed');
    const { today } = await this.center(tenant);
    const before = contentOf(row);
    const after = await this.merge(tenant, row, dto, { complete: true, today });
    const changed = changedLabels(
      storedDefinition(row.templateVersion.definition),
      before,
      after,
    );
    if (!changed.length) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'Nothing has changed. Make the correction, then save the amendment.',
        'NOTHING_CHANGED',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await this.store(
        tx,
        tenant,
        row,
        after,
        [AssessmentStatus.COMPLETED, AssessmentStatus.AMENDED],
        { status: AssessmentStatus.AMENDED },
      );
      const number = row.amendments.length + 1;
      await tx.assessmentAmendment.create({
        data: {
          centerId: tenant.centerId,
          assessmentId: id,
          number,
          reason: dto.reason,
          changedFields: changed,
          previousContent: before as unknown as Prisma.InputJsonValue,
          previousRevision: row.revision,
          amendedById: tenant.userId,
        },
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'assessment.amended',
          entityType: 'Assessment',
          entityId: id,
          // Field labels come from the center's template, never answers.
          metadata: {
            patientCode: row.patient.code,
            amendment: number,
            changedFields: changed,
          },
          ipAddress: ip,
        },
        tx,
      );
    });
    return this.get(tenant, id);
  }

  /** Throws a draft away. Completed assessments are kept (and the database insists). */
  async discard(tenant: TenantContext, id: string, ip: string | null) {
    const { row } = await this.detail(tenant, id);
    if (!isOwn(tenant, row.therapist)) throw notYours(row.therapist.fullName);
    if (row.status !== AssessmentStatus.DRAFT) {
      throw apiError(
        HttpStatus.CONFLICT,
        'Completed assessments are part of the clinical record and can’t be deleted.',
        'ASSESSMENT_COMPLETED',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.assessment.deleteMany({
        where: {
          id,
          centerId: tenant.centerId,
          status: AssessmentStatus.DRAFT,
        },
      });
      if (removed.count === 0) throw changedMeanwhile();
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'assessment.discarded',
          entityType: 'Assessment',
          entityId: id,
          metadata: { patientCode: row.patient.code },
          ipAddress: ip,
        },
        tx,
      );
    });
  }
}
