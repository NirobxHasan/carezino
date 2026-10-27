import { HttpStatus, Injectable } from '@nestjs/common';

import type { TenantContext } from '../auth/auth-context';
import { apiError } from '../common/errors';
import { formatIsoDate, instantToZoned } from '../common/time';
import {
  AppointmentType,
  PackageChargeReason,
  PackageEnrollmentState,
  PackageLedgerMovement,
  PackageReleaseReason,
  PackageReservationStatus,
} from '../generated/prisma/enums';
import { fieldError } from '../patients/contacts';
import {
  periodOf,
  sessionProblems,
  validityEnd,
  validityFor,
  type EnrollmentFacts,
  type SessionProblem,
} from './rules';
import {
  isBalanceViolation,
  lockEnrollment,
  noSessionsLeft,
  toFacts,
  type Db,
  type Tx,
} from './shared';

/** A booked appointment as package checks see it. */
export interface BookedSession {
  appointmentId: string;
  patientId: string;
  therapyTypeId: string;
  type: AppointmentType;
  startAt: Date;
}

/** The center's time zone and week start, from the booking policy. */
export interface SessionPolicy {
  timeZone: string;
  weekStartsOn: number;
}

/** How an appointment ended, for what happens to its held session. */
export type SessionOutcome = 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';

const PERIOD_WORDS = { DAY: 'day', WEEK: 'week', MONTH: 'month' } as const;

/** "30 Nov 2026" */
export function dateText(date: Date) {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Why a session can't use a package, in words staff can act on. */
export function problemMessage(
  problem: SessionProblem,
  e: EnrollmentFacts & { code: string; packageName: string },
  sessionDates: Date[],
) {
  const name = `${e.packageName} (${e.code})`;
  switch (problem) {
    case 'CANCELLED':
      return `${name} was cancelled`;
    case 'OTHER_PATIENT':
      return `${name} belongs to another patient`;
    case 'THERAPY_NOT_COVERED':
      return `${name} doesn’t cover this therapy`;
    case 'ASSESSMENT_NOT_COVERED':
      return `${name} covers therapy sessions, not assessments`;
    case 'BEFORE_START':
      return `${name} is valid from ${dateText(validityFor(e, sessionDates).start)}`;
    case 'AFTER_END': {
      const window = validityFor(e, sessionDates);
      return e.startDate
        ? `${name} is valid until ${dateText(window.end)}`
        : `${name} would be valid for ${e.validityValue} ${PERIOD_WORDS[e.validityUnit]}${e.validityValue === 1 ? '' : 's'} from its first session, so its sessions must fall between ${dateText(window.start)} and ${dateText(window.end)}`;
    }
    case 'NO_SESSIONS':
      return `${name} has no sessions left to book`;
    case 'USAGE_LIMIT':
      return `${name} allows ${e.usageLimitCount} session${e.usageLimitCount === 1 ? '' : 's'} per ${PERIOD_WORDS[e.usageLimitPeriod!]}`;
  }
}

/**
 * How appointments use packages, for the appointments module: holding a session when a
 * package is chosen for a booking, re-checking it when the booking moves, and settling
 * it when the booking ends. Every call runs inside the caller's transaction, after the
 * appointment row is written, and locks the enrollment before touching its balance
 * (lock order: therapist, patient, appointment, enrollment), so balances can't be
 * overdrawn and nothing is charged twice. Nothing here books, moves or cancels
 * appointments, and nothing touches money.
 */
@Injectable()
export class PackageSessions {
  /** The appointment's calendar date where the center is. */
  localDate(startAt: Date, timeZone: string) {
    return instantToZoned(startAt, timeZone).date;
  }

  /**
   * The enrollment's held (and, for usage limits, charged) session dates, leaving out
   * one appointment's own.
   */
  private async usage(
    db: Db,
    enrollmentId: string,
    exceptAppointmentId?: string,
  ) {
    const rows = await db.packageSessionReservation.findMany({
      where: {
        enrollmentId,
        status: {
          in: [
            PackageReservationStatus.ACTIVE,
            PackageReservationStatus.CONSUMED,
          ],
        },
        ...(exceptAppointmentId && {
          appointmentId: { not: exceptAppointmentId },
        }),
      },
      select: { sessionDate: true, status: true },
    });
    return {
      held: rows
        .filter((r) => r.status === PackageReservationStatus.ACTIVE)
        .map((r) => r.sessionDate),
      used: rows.map((r) => r.sessionDate),
    };
  }

  /** Every problem with each session, judged as if the earlier ones were already held. */
  evaluate(
    e: EnrollmentFacts,
    sessions: {
      session: Omit<BookedSession, 'startAt' | 'appointmentId'>;
      date: Date;
    }[],
    usage: { held: Date[]; used: Date[] },
    {
      weekStartsOn,
      needsSession,
    }: { weekStartsOn: number; needsSession: boolean },
  ) {
    let facts = e;
    const held = [...usage.held];
    const used = [...usage.used];
    return sessions.map(({ session, date }) => {
      const period =
        e.usageLimitPeriod && periodOf(date, e.usageLimitPeriod, weekStartsOn);
      const usedInPeriod = period
        ? used.filter((d) => d >= period.from && d <= period.to).length
        : 0;
      const problems = sessionProblems(
        facts,
        { ...session, date },
        { heldDates: held, usedInPeriod, needsSession },
      );
      const dates = [date, ...held];
      held.push(date);
      used.push(date);
      if (needsSession) {
        facts = { ...facts, reservedSessions: facts.reservedSessions + 1 };
      }
      return { date, problems, dates };
    });
  }

  private notApplicable(
    e: Awaited<ReturnType<typeof lockEnrollment>>,
    results: ReturnType<PackageSessions['evaluate']>,
    extra: Record<string, unknown> = {},
  ) {
    const facts = toFacts(e);
    const problems = results.flatMap((r) =>
      r.problems.map((reason) => ({
        reason,
        date: formatIsoDate(r.date),
        message: problemMessage(reason, { ...facts, ...e }, r.dates),
      })),
    );
    const failed = results.filter((r) => r.problems.length).length;
    const message =
      results.length > 1
        ? `${problems[0].message} (${failed} of ${results.length} sessions)`
        : problems[0].message;
    return apiError(
      HttpStatus.CONFLICT,
      message,
      'PACKAGE_NOT_APPLICABLE',
      undefined,
      { packageEnrollmentId: e.id, problems, ...extra },
    );
  }

  /**
   * Holds one session of the enrollment for each appointment, all or nothing: each must
   * be the enrollment's patient, a covered therapy and type, inside its validity and
   * usage limit, with a session free to book. Callers set the appointments'
   * packageEnrollmentId themselves.
   */
  async reserve(
    tx: Tx,
    tenant: TenantContext,
    enrollmentId: string,
    sessions: BookedSession[],
    policy: SessionPolicy,
  ) {
    if (!sessions.length) return;
    const row = await lockEnrollment(tx, tenant, enrollmentId, () =>
      fieldError(
        'packageEnrollmentId',
        'This package no longer exists. Choose another.',
        'PACKAGE_NOT_FOUND',
      ),
    );
    const dated = sessions
      .map((s) => ({ s, date: this.localDate(s.startAt, policy.timeZone) }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    const results = this.evaluate(
      toFacts(row),
      dated.map(({ s, date }) => ({ session: s, date })),
      await this.usage(tx, enrollmentId),
      { weekStartsOn: policy.weekStartsOn, needsSession: true },
    );
    if (results.some((r) => r.problems.length)) {
      throw this.notApplicable(row, results);
    }
    try {
      await tx.packageSessionReservation.createMany({
        data: dated.map(({ s, date }) => ({
          centerId: tenant.centerId,
          enrollmentId,
          appointmentId: s.appointmentId,
          sessionDate: date,
          createdById: tenant.userId,
        })),
      });
    } catch (error) {
      if (isBalanceViolation(error)) throw noSessionsLeft();
      throw error;
    }
  }

  /**
   * Re-checks an appointment's held session after it moved (date, therapy or type).
   * Still fine: its session date follows. Not fine: a 409 the caller can resolve by
   * taking the package off the booking (`removable`).
   */
  async move(
    tx: Tx,
    tenant: TenantContext,
    session: BookedSession,
    policy: SessionPolicy,
  ) {
    const held = await tx.packageSessionReservation.findFirst({
      where: {
        appointmentId: session.appointmentId,
        centerId: tenant.centerId,
        status: PackageReservationStatus.ACTIVE,
      },
      select: { id: true, enrollmentId: true },
    });
    if (!held) return;
    const row = await lockEnrollment(tx, tenant, held.enrollmentId);
    const date = this.localDate(session.startAt, policy.timeZone);
    const results = this.evaluate(
      toFacts(row),
      [{ session, date }],
      await this.usage(tx, held.enrollmentId, session.appointmentId),
      { weekStartsOn: policy.weekStartsOn, needsSession: false },
    );
    if (results[0].problems.length) {
      throw this.notApplicable(row, results, { removable: true });
    }
    await tx.packageSessionReservation.update({
      where: { id: held.id },
      data: { sessionDate: date },
    });
  }

  /** Gives back an appointment's held session, if it has one. */
  async release(
    tx: Tx,
    tenant: TenantContext,
    appointmentId: string,
    reason: PackageReleaseReason,
  ) {
    const held = await tx.packageSessionReservation.findFirst({
      where: {
        appointmentId,
        centerId: tenant.centerId,
        status: PackageReservationStatus.ACTIVE,
      },
      select: { id: true, enrollmentId: true },
    });
    if (!held) return null;
    await lockEnrollment(tx, tenant, held.enrollmentId);
    await tx.packageSessionReservation.updateMany({
      where: { id: held.id, status: PackageReservationStatus.ACTIVE },
      data: {
        status: PackageReservationStatus.RELEASED,
        releasedAt: new Date(),
        releasedById: tenant.userId,
        releaseReason: reason,
      },
    });
    return held.enrollmentId;
  }

  /**
   * What happens to an appointment's held session when it ends, by the enrollment's
   * own policy: a completed session is charged; a no-show or a late cancellation only
   * when the package says so; anything else gives the session back. Charging converts
   * the reservation and appends one consumption, and activates a first-session
   * enrollment. Idempotent: an appointment without a held session changes nothing, and
   * the database refuses a second consumption for the same appointment.
   */
  async settle(
    tx: Tx,
    tenant: TenantContext,
    appointmentId: string,
    outcome: SessionOutcome,
    { late = false } = {},
  ) {
    const held = await tx.packageSessionReservation.findFirst({
      where: {
        appointmentId,
        centerId: tenant.centerId,
        status: PackageReservationStatus.ACTIVE,
      },
      select: { id: true, enrollmentId: true, sessionDate: true },
    });
    if (!held) return;
    const e = await lockEnrollment(tx, tenant, held.enrollmentId);
    const chargeReason =
      outcome === 'COMPLETED'
        ? PackageChargeReason.COMPLETED
        : outcome === 'NO_SHOW' && e.chargeNoShow
          ? PackageChargeReason.NO_SHOW
          : outcome === 'CANCELLED' && late && e.chargeLateCancellation
            ? PackageChargeReason.LATE_CANCELLATION
            : null;
    const now = new Date();
    if (!chargeReason) {
      await tx.packageSessionReservation.updateMany({
        where: { id: held.id, status: PackageReservationStatus.ACTIVE },
        data: {
          status: PackageReservationStatus.RELEASED,
          releasedAt: now,
          releasedById: tenant.userId,
          releaseReason:
            outcome === 'NO_SHOW'
              ? PackageReleaseReason.NO_SHOW_NOT_CHARGED
              : PackageReleaseReason.APPOINTMENT_CANCELLED,
        },
      });
      return;
    }
    // The reservation ends first, so the held session isn't counted twice on the way.
    const { count } = await tx.packageSessionReservation.updateMany({
      where: { id: held.id, status: PackageReservationStatus.ACTIVE },
      data: { status: PackageReservationStatus.CONSUMED, consumedAt: now },
    });
    if (!count) return;
    await tx.packageSessionLedger.create({
      data: {
        centerId: tenant.centerId,
        enrollmentId: e.id,
        movement: PackageLedgerMovement.SESSION_CONSUMPTION,
        quantity: -1,
        appointmentId,
        reservationId: held.id,
        chargeReason,
        createdById: tenant.userId,
      },
    });
    if (!e.startDate && e.state === PackageEnrollmentState.PENDING) {
      // First-session activation: from the earliest session it pays for or holds, so
      // every held session stays inside the validity it was booked under.
      const { held: others } = await this.usage(tx, e.id);
      const start = new Date(
        Math.min(held.sessionDate.getTime(), ...others.map((d) => d.getTime())),
      );
      await tx.packageEnrollment.update({
        where: { id: e.id },
        data: {
          state: PackageEnrollmentState.ACTIVE,
          startDate: start,
          endDate: validityEnd(start, e.validityValue, e.validityUnit),
          activatedAt: now,
        },
      });
    }
  }

  /**
   * Gives back the session an appointment was charged, when the appointment turns out
   * not to have happened (a session completed by mistake). Appends one reversal pointing
   * at the consumption, which stays in the ledger. Returns the enrollment's ID, or null
   * when nothing was charged. Idempotent: a consumption that's already reversed is left
   * alone, and the database refuses a second reversal of the same consumption. The
   * appointment can't be charged again afterwards (one consumption per appointment).
   */
  async reverse(
    tx: Tx,
    tenant: TenantContext,
    appointmentId: string,
    reason: string,
  ) {
    const charged = await tx.packageSessionLedger.findFirst({
      where: {
        appointmentId,
        centerId: tenant.centerId,
        movement: PackageLedgerMovement.SESSION_CONSUMPTION,
      },
      select: { id: true, enrollmentId: true },
    });
    if (!charged) return null;
    await lockEnrollment(tx, tenant, charged.enrollmentId);
    const reversed = await tx.packageSessionLedger.findFirst({
      where: { reversesId: charged.id },
      select: { id: true },
    });
    if (reversed) return null;
    await tx.packageSessionLedger.create({
      data: {
        centerId: tenant.centerId,
        enrollmentId: charged.enrollmentId,
        movement: PackageLedgerMovement.CONSUMPTION_REVERSAL,
        quantity: 1,
        reversesId: charged.id,
        reason,
        createdById: tenant.userId,
      },
    });
    return charged.enrollmentId;
  }
}
