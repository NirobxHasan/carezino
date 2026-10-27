import { HttpStatus, Injectable } from '@nestjs/common';

import { appointmentSearch } from '../appointments/appointments.service';
import { OPEN_STATUSES } from '../appointments/rules';
import { assessablePatients } from '../assessments/access';
import type { TenantContext } from '../auth/auth-context';
import { SettingsService } from '../center-settings/settings.service';
import { apiError } from '../common/errors';
import {
  addDays,
  formatIsoDate,
  parseIsoDate,
  todayIn,
  zonedToInstant,
} from '../common/time';
import type { Prisma } from '../generated/prisma/client';
import {
  AppointmentStatus,
  AppointmentType,
  AttendanceStatus,
  PackageLedgerMovement,
  PackageReservationStatus,
  SessionNoteStatus,
  TherapyPlanStatus,
  TherapySessionStatus,
} from '../generated/prisma/enums';
import { patientNotFound } from '../patients/access';
import { PrismaService } from '../prisma/prisma.service';
import { listablePlans } from '../therapy-plans/access';
import { readableNotes, sessionNotFound, visibleSessions } from './access';
import type {
  ListSessionsQuery,
  PatientSessionsQuery,
  TodaySessionsQuery,
} from './dto';
import {
  attendanceOf,
  attended,
  isOpen,
  noteStateOf,
  notePending,
  type NoteState,
} from './rules';
import {
  sessionItemSelect,
  toSessionItem,
  userSelect,
  type SessionItemRow,
  type SessionView,
} from './shared';

const detailSelect = {
  ...sessionItemSelect,
  attendance: {
    select: {
      status: true,
      checkInAt: true,
      actualStartAt: true,
      actualEndAt: true,
      note: true,
      revision: true,
      recordedAt: true,
      recordedBy: userSelect,
    },
  },
  session: {
    select: {
      status: true,
      startedAt: true,
      completedAt: true,
      voidedAt: true,
      voidReason: true,
      therapyPlanId: true,
      therapyPlan: { select: { id: true, code: true, status: true } },
      startedBy: userSelect,
      completedBy: userSelect,
      voidedBy: userSelect,
      note: {
        select: {
          id: true,
          status: true,
          completedAt: true,
          updatedAt: true,
          completedBy: userSelect,
          therapist: {
            select: { id: true, fullName: true, membershipId: true },
          },
        },
      },
    },
  },
  patientId: true,
  therapyTypeId: true,
  packageEnrollment: { select: { id: true, code: true, packageName: true } },
  packageReservations: {
    select: { enrollmentId: true, status: true, releaseReason: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
  packageMovements: {
    where: { movement: PackageLedgerMovement.SESSION_CONSUMPTION },
    select: {
      enrollmentId: true,
      chargeReason: true,
      reversedBy: { select: { id: true } },
    },
  },
  history: {
    select: {
      id: true,
      action: true,
      previousValues: true,
      newValues: true,
      reason: true,
      createdAt: true,
      performedBy: userSelect,
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.AppointmentSelect;

type DetailRow = Prisma.AppointmentGetPayload<{ select: typeof detailSelect }>;

const ATTENDED_WHERE: Prisma.AppointmentWhereInput = {
  attendance: {
    is: { status: { in: [AttendanceStatus.PRESENT, AttendanceStatus.LATE] } },
  },
};

const NO_NOTE: Prisma.AppointmentWhereInput = {
  OR: [{ session: { is: null } }, { session: { is: { note: { is: null } } } }],
};

/** Attendance as recorded, or as the appointment's status implies (rules.ts attendanceOf). */
function attendanceWhere(
  status: AttendanceStatus,
): Prisma.AppointmentWhereInput {
  switch (status) {
    case AttendanceStatus.NOT_MARKED:
      return {
        status: { not: AppointmentStatus.NO_SHOW },
        OR: [
          { attendance: { is: null } },
          { attendance: { is: { status: AttendanceStatus.NOT_MARKED } } },
        ],
      };
    case AttendanceStatus.ABSENT:
      return {
        OR: [
          { attendance: { is: { status: AttendanceStatus.ABSENT } } },
          { status: AppointmentStatus.NO_SHOW, attendance: { is: null } },
        ],
      };
    default:
      return { attendance: { is: { status } } };
  }
}

function sessionStatusWhere(
  status: TherapySessionStatus,
): Prisma.AppointmentWhereInput {
  return status === TherapySessionStatus.NOT_STARTED
    ? { session: { is: null } }
    : { session: { is: { status } } };
}

function noteWhere(state: NoteState | 'PENDING'): Prisma.AppointmentWhereInput {
  if (state === 'NONE') return NO_NOTE;
  if (state === 'PENDING') {
    return {
      type: AppointmentType.THERAPY_SESSION,
      status: AppointmentStatus.COMPLETED,
      OR: [
        ...NO_NOTE.OR!,
        {
          session: {
            is: { note: { is: { status: SessionNoteStatus.DRAFT } } },
          },
        },
      ],
    };
  }
  return { session: { is: { note: { is: { status: state } } } } };
}

/**
 * Reading sessions: the front desk's day, the history, one session, a therapist's own
 * sessions and a patient's. Every list is a list of appointments (visibleSessions)
 * with their attendance, session and note status; note content is the notes service's.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async view(
    tenant: TenantContext,
    rows: { session: { note: { id: string } | null } | null }[],
  ): Promise<SessionView> {
    const center = await this.prisma.center.findUniqueOrThrow({
      where: { id: tenant.centerId },
      select: { timezone: true },
    });
    const scheduling = await this.settings.getScheduling(tenant);
    const now = new Date();
    const ids = rows.flatMap((r) =>
      r.session?.note ? [r.session.note.id] : [],
    );
    let readable = new Set(ids);
    if (!tenant.permissions.includes('session_notes.read') && ids.length) {
      const found = await this.prisma.sessionNote.findMany({
        where: { AND: [readableNotes(tenant), { id: { in: ids } }] },
        select: { id: true },
      });
      readable = new Set(found.map((n) => n.id));
    }
    return {
      tenant,
      timeZone: center.timezone,
      now,
      today: formatIsoDate(todayIn(center.timezone, now)),
      cancellationCutoffMinutes: scheduling.cancellationCutoffMinutes,
      readableNotes: readable,
    };
  }

  private date(value: string, field: string) {
    const date = parseIsoDate(value);
    if (!date) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'Please check the highlighted fields',
        'VALIDATION_FAILED',
        { [field]: 'Choose a valid date' },
      );
    }
    return date;
  }

  /** Center-local dates, both included, as a half-open range of instants. */
  private range(first: Date | null, last: Date | null, timeZone: string) {
    return {
      ...(first && { gte: zonedToInstant(first, 0, timeZone) }),
      ...(last && { lt: zonedToInstant(addDays(last, 1), 0, timeZone) }),
    };
  }

  private filters(
    query: TodaySessionsQuery | ListSessionsQuery,
  ): Prisma.AppointmentWhereInput[] {
    const any = <T>(
      list: T[] | undefined,
      where: (v: T) => Prisma.AppointmentWhereInput,
    ) => (list?.length ? [{ OR: list.map(where) }] : []);
    return [
      {
        ...(query.therapistId && { therapistId: query.therapistId }),
        ...(query.therapyTypeId && { therapyTypeId: query.therapyTypeId }),
        ...(query.patientId && { patientId: query.patientId }),
        ...(query.type && { type: query.type }),
        ...(query.status?.length && { status: { in: query.status } }),
      },
      ...(query.search ? [appointmentSearch(query.search)] : []),
      ...any(query.attendance, attendanceWhere),
      ...any(query.sessionStatus, sessionStatusWhere),
      ...any(query.noteStatus, noteWhere),
    ];
  }

  private async page(
    tenant: TenantContext,
    where: Prisma.AppointmentWhereInput,
    {
      page,
      pageSize,
      order,
    }: { page: number; pageSize: number; order: 'asc' | 'desc' },
  ) {
    const [total, rows] = await Promise.all([
      this.prisma.appointment.count({ where }),
      this.prisma.appointment.findMany({
        where,
        select: sessionItemSelect,
        orderBy: [{ startAt: order }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const view = await this.view(tenant, rows);
    return {
      items: rows.map((r) => toSessionItem(r, view)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * One day's sessions (today unless a date is given) in time order, with counts for
   * the whole day whatever the filters: expected, arrived, not marked, absent,
   * completed, cancelled and notes pending.
   */
  async today(tenant: TenantContext, query: TodaySessionsQuery) {
    const center = await this.prisma.center.findUniqueOrThrow({
      where: { id: tenant.centerId },
      select: { timezone: true },
    });
    const day = query.date
      ? this.date(query.date, 'date')
      : todayIn(center.timezone);
    const startAt = this.range(day, day, center.timezone);
    const dayWhere = { AND: [visibleSessions(tenant), { startAt }] };
    const all = await this.prisma.appointment.findMany({
      where: dayWhere,
      select: {
        status: true,
        type: true,
        attendance: { select: { status: true } },
        session: { select: { note: { select: { status: true } } } },
      },
    });
    const count = (test: (a: (typeof all)[number]) => boolean) =>
      all.filter(test).length;
    const att = (a: (typeof all)[number]) =>
      attendanceOf(a.status, a.attendance?.status);
    const summary = {
      expected: count((a) => a.status !== AppointmentStatus.CANCELLED),
      arrived: count((a) => attended(att(a))),
      notMarked: count(
        (a) => isOpen(a.status) && att(a) === AttendanceStatus.NOT_MARKED,
      ),
      absent: count((a) => a.status === AppointmentStatus.NO_SHOW),
      completed: count((a) => a.status === AppointmentStatus.COMPLETED),
      cancelled: count((a) => a.status === AppointmentStatus.CANCELLED),
      notesPending: count((a) =>
        notePending({
          type: a.type,
          appointmentStatus: a.status,
          note: noteStateOf(a.session?.note),
        }),
      ),
    };
    const list = await this.page(
      tenant,
      { AND: [dayWhere, ...this.filters(query)] },
      { page: query.page ?? 1, pageSize: query.pageSize ?? 100, order: 'asc' },
    );
    return {
      date: formatIsoDate(day),
      timezone: center.timezone,
      summary,
      ...list,
    };
  }

  /** Session history: any dates and filters, newest first unless asked otherwise. */
  async list(tenant: TenantContext, query: ListSessionsQuery) {
    const center = await this.prisma.center.findUniqueOrThrow({
      where: { id: tenant.centerId },
      select: { timezone: true },
    });
    const startAt = this.range(
      query.from ? this.date(query.from, 'from') : null,
      query.to ? this.date(query.to, 'to') : null,
      center.timezone,
    );
    return this.page(
      tenant,
      {
        AND: [
          visibleSessions(tenant),
          Object.keys(startAt).length ? { startAt } : {},
          ...this.filters(query),
        ],
      },
      {
        page: query.page ?? 1,
        pageSize: Math.min(query.pageSize ?? 20, 100),
        order: query.sortOrder ?? 'desc',
      },
    );
  }

  /**
   * A therapist's own day and backlog: today's sessions, notes still to write or sign
   * off (oldest first), and recently completed sessions. Empty for staff without a
   * linked therapist profile.
   */
  async mine(tenant: TenantContext) {
    const therapist = await this.prisma.therapist.findFirst({
      where: {
        centerId: tenant.centerId,
        membershipId: tenant.membershipId,
        deletedAt: null,
      },
      select: { id: true, code: true, fullName: true },
    });
    if (!therapist) {
      return { therapist: null, today: [], pendingNotes: [], recent: [] };
    }
    const center = await this.prisma.center.findUniqueOrThrow({
      where: { id: tenant.centerId },
      select: { timezone: true },
    });
    const day = todayIn(center.timezone);
    const today = this.range(day, day, center.timezone);
    const mine = { centerId: tenant.centerId, therapistId: therapist.id };
    const [todayRows, pendingRows, recentRows] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          ...mine,
          startAt: today,
          status: { not: AppointmentStatus.CANCELLED },
        },
        select: sessionItemSelect,
        orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
        take: 100,
      }),
      this.prisma.appointment.findMany({
        where: {
          ...mine,
          type: AppointmentType.THERAPY_SESSION,
          startAt: { lt: today.lt },
          OR: [
            noteWhere('PENDING'),
            {
              status: { in: OPEN_STATUSES },
              session: {
                is: { note: { is: { status: SessionNoteStatus.DRAFT } } },
              },
            },
            // Attended on an earlier day but never completed or written up; today's
            // are still under way, in "today".
            {
              status: { in: OPEN_STATUSES },
              startAt: { lt: today.gte },
              ...ATTENDED_WHERE,
              ...NO_NOTE,
            },
          ],
        },
        select: sessionItemSelect,
        orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
        take: 50,
      }),
      this.prisma.appointment.findMany({
        where: {
          ...mine,
          status: AppointmentStatus.COMPLETED,
          startAt: { gte: addDays(today.gte!, -14), lt: today.lt },
        },
        select: sessionItemSelect,
        orderBy: [{ startAt: 'desc' }, { id: 'asc' }],
        take: 20,
      }),
    ]);
    const view = await this.view(tenant, [
      ...todayRows,
      ...pendingRows,
      ...recentRows,
    ]);
    const item = (r: SessionItemRow) => toSessionItem(r, view);
    return {
      therapist,
      today: todayRows.map(item),
      pendingNotes: pendingRows.map(item),
      recent: recentRows.map(item),
    };
  }

  /**
   * A patient's sessions, newest first, with how many goals each readable note
   * recorded progress for. Therapists see their own sessions with the patient.
   */
  async patientSessions(
    tenant: TenantContext,
    patientId: string,
    query: PatientSessionsQuery,
  ) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, ...assessablePatients(tenant) },
      select: { id: true, code: true, fullName: true },
    });
    if (!patient) throw patientNotFound();
    const result = await this.page(
      tenant,
      { AND: [visibleSessions(tenant), { patientId }] },
      {
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
        order: 'desc',
      },
    );
    const noteIds = result.items.flatMap((i) =>
      i.note && i.sessionActions.viewNote ? [i.note.id] : [],
    );
    const counts = noteIds.length
      ? await this.prisma.therapyGoalProgress.groupBy({
          by: ['sessionNoteId'],
          where: { sessionNoteId: { in: noteIds }, correctedBy: { is: null } },
          _count: { _all: true },
        })
      : [];
    const byNote = new Map(counts.map((c) => [c.sessionNoteId, c._count._all]));
    return {
      patient,
      ...result,
      items: result.items.map((i) => ({
        ...i,
        /** Goals with progress recorded in the note; null without clinical access */
        goalsRecorded:
          i.note && i.sessionActions.viewNote
            ? i.note.status === SessionNoteStatus.DRAFT
              ? 0
              : (byNote.get(i.note.id) ?? 0)
            : null,
      })),
    };
  }

  // ── One session ───────────────────────────────────────────────────────────

  private async find(tenant: TenantContext, id: string) {
    const row = await this.prisma.appointment.findFirst({
      where: { id, ...visibleSessions(tenant) },
      select: detailSelect,
    });
    if (!row) throw sessionNotFound();
    return row;
  }

  /** The plan the session belongs to (or the patient's open one), if the caller may list it. */
  private async plan(tenant: TenantContext, row: DetailRow) {
    if (row.type !== AppointmentType.THERAPY_SESSION) return null;
    return this.prisma.therapyPlan.findFirst({
      where: {
        AND: [
          listablePlans(tenant),
          row.session?.therapyPlanId
            ? { id: row.session.therapyPlanId }
            : {
                patientId: row.patientId,
                therapyTypeId: row.therapyTypeId,
                status: {
                  in: [TherapyPlanStatus.ACTIVE, TherapyPlanStatus.PAUSED],
                },
              },
        ],
      },
      select: { id: true, code: true, title: true, status: true },
    });
  }

  /** Which package pays for it and where that stands; never prices or balances. */
  private packageOf(row: DetailRow) {
    const enrollment = row.packageEnrollment;
    if (!enrollment) return null;
    const charge = row.packageMovements.find(
      (m) => m.enrollmentId === enrollment.id,
    );
    const reservation = row.packageReservations.find(
      (r) => r.enrollmentId === enrollment.id,
    );
    return {
      enrollmentId: enrollment.id,
      code: enrollment.code,
      name: enrollment.packageName,
      coverage: charge
        ? charge.reversedBy
          ? ('REVERSED' as const)
          : ('CHARGED' as const)
        : reservation?.status === PackageReservationStatus.ACTIVE
          ? ('HELD' as const)
          : ('RELEASED' as const),
      chargeReason: charge?.chargeReason ?? null,
      releaseReason: charge ? null : (reservation?.releaseReason ?? null),
    };
  }

  async get(tenant: TenantContext, id: string) {
    const row = await this.find(tenant, id);
    const view = await this.view(tenant, [row]);
    const item = toSessionItem(row, view);
    const session = row.session;
    const note = session?.note ?? null;
    return {
      ...item,
      attendance: {
        ...item.attendance,
        note: row.attendance?.note ?? null,
        revision: row.attendance?.revision ?? null,
        recordedAt: row.attendance?.recordedAt ?? null,
        recordedBy: row.attendance?.recordedBy ?? null,
      },
      session: {
        status: item.sessionStatus,
        startedAt: session?.startedAt ?? null,
        startedBy: session?.startedBy ?? null,
        completedAt: session?.completedAt ?? null,
        completedBy: session?.completedBy ?? null,
        voidedAt: session?.voidedAt ?? null,
        voidedBy: session?.voidedBy ?? null,
        voidReason: session?.voidReason ?? null,
      },
      note: note && {
        id: note.id,
        status: note.status,
        completedAt: note.completedAt,
        completedBy: note.completedBy,
        updatedAt: note.updatedAt,
        therapist: { id: note.therapist.id, fullName: note.therapist.fullName },
      },
      plan: await this.plan(tenant, row),
      package: this.packageOf(row),
      history: row.history,
    };
  }

  /** GET /appointments/:id/attendance */
  async attendance(tenant: TenantContext, id: string) {
    const { attendance, id: appointmentId } = await this.get(tenant, id);
    return { appointmentId, ...attendance };
  }
}
