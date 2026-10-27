import {
  AppointmentStatus as A,
  AppointmentType,
  AttendanceStatus as Att,
  SessionNoteStatus,
  TherapySessionStatus,
} from '../generated/prisma/enums';
import {
  attendanceOf,
  attendanceTimeErrors,
  attended,
  completionRefusal,
  notePending,
  planAttendance,
  sessionStatusOf,
} from './rules';

const plan = (
  appointmentStatus: A,
  next: Att,
  {
    current = Att.NOT_MARKED,
    started = true,
    dueOrPast = true,
  }: { current?: Att; started?: boolean; dueOrPast?: boolean } = {},
) => planAttendance({ appointmentStatus, current, next, started, dueOrPast });

describe('session rules', () => {
  it('counts late as attended and only absent as an absence', () => {
    expect(attended(Att.PRESENT)).toBe(true);
    expect(attended(Att.LATE)).toBe(true);
    expect(attended(Att.ABSENT)).toBe(false);
    expect(attended(Att.NOT_MARKED)).toBe(false);
  });

  it('reads a no-show without recorded attendance as absent', () => {
    expect(attendanceOf(A.NO_SHOW, null)).toBe(Att.ABSENT);
    expect(attendanceOf(A.SCHEDULED, null)).toBe(Att.NOT_MARKED);
    expect(attendanceOf(A.COMPLETED, Att.LATE)).toBe(Att.LATE);
  });

  describe('attendance changes', () => {
    it('records attendance on open appointments without changing them', () => {
      for (const status of [A.SCHEDULED, A.CONFIRMED]) {
        for (const next of [Att.PRESENT, Att.LATE, Att.NOT_MARKED]) {
          expect(plan(status, next)).toEqual({
            ok: true,
            appointment: 'KEEP',
            correction: false,
          });
        }
      }
    });

    it('makes an absent patient a no-show, once the appointment has started', () => {
      expect(plan(A.SCHEDULED, Att.ABSENT)).toEqual({
        ok: true,
        appointment: 'NO_SHOW',
        correction: false,
      });
      expect(plan(A.SCHEDULED, Att.ABSENT, { started: false })).toMatchObject({
        ok: false,
        code: 'APPOINTMENT_NOT_STARTED',
      });
    });

    it('refuses attendance for future days and cancelled appointments', () => {
      expect(
        plan(A.SCHEDULED, Att.PRESENT, { started: false, dueOrPast: false }),
      ).toMatchObject({ ok: false, code: 'APPOINTMENT_NOT_DUE' });
      for (const next of [Att.PRESENT, Att.ABSENT, Att.NOT_MARKED]) {
        expect(plan(A.CANCELLED, next)).toMatchObject({
          ok: false,
          code: 'APPOINTMENT_CANCELLED',
        });
      }
    });

    it('treats changes after completion as corrections between attended states', () => {
      expect(plan(A.COMPLETED, Att.LATE, { current: Att.PRESENT })).toEqual({
        ok: true,
        appointment: 'KEEP',
        correction: true,
      });
      for (const next of [Att.ABSENT, Att.NOT_MARKED]) {
        expect(plan(A.COMPLETED, next, { current: Att.PRESENT })).toMatchObject(
          { ok: false, code: 'USE_SESSION_CORRECTION' },
        );
      }
    });

    it('reopens a no-show who came after all, as a correction', () => {
      expect(plan(A.NO_SHOW, Att.LATE, { current: Att.ABSENT })).toEqual({
        ok: true,
        appointment: 'REOPEN',
        correction: true,
      });
      expect(
        plan(A.NO_SHOW, Att.NOT_MARKED, { current: Att.ABSENT }),
      ).toMatchObject({ ok: false, code: 'INVALID_ATTENDANCE' });
    });
  });

  describe('completion', () => {
    const refusal = (
      appointmentStatus: A,
      attendance: Att,
      { started = true, attendanceGiven = false } = {},
    ) =>
      completionRefusal({
        appointmentStatus,
        attendance,
        started,
        attendanceGiven,
      });

    it('needs an open, started appointment with the patient there', () => {
      expect(refusal(A.SCHEDULED, Att.PRESENT)).toBeNull();
      expect(refusal(A.CONFIRMED, Att.LATE)).toBeNull();
      expect(refusal(A.SCHEDULED, Att.NOT_MARKED)).toMatchObject({
        code: 'ATTENDANCE_REQUIRED',
      });
      expect(
        refusal(A.SCHEDULED, Att.NOT_MARKED, { attendanceGiven: true }),
      ).toBeNull();
      expect(
        refusal(A.SCHEDULED, Att.PRESENT, { started: false }),
      ).toMatchObject({ code: 'APPOINTMENT_NOT_STARTED' });
      for (const closed of [A.CANCELLED, A.NO_SHOW]) {
        expect(refusal(closed, Att.PRESENT)).toMatchObject({
          code: 'INVALID_STATUS_TRANSITION',
        });
      }
    });
  });

  it('derives session and note states', () => {
    expect(sessionStatusOf(null)).toBe(TherapySessionStatus.NOT_STARTED);
    expect(sessionStatusOf({ status: TherapySessionStatus.COMPLETED })).toBe(
      TherapySessionStatus.COMPLETED,
    );
    const pending = (
      type: AppointmentType,
      status: A,
      note: 'NONE' | SessionNoteStatus,
    ) => notePending({ type, appointmentStatus: status, note });
    expect(pending(AppointmentType.THERAPY_SESSION, A.COMPLETED, 'NONE')).toBe(
      true,
    );
    expect(
      pending(
        AppointmentType.THERAPY_SESSION,
        A.COMPLETED,
        SessionNoteStatus.DRAFT,
      ),
    ).toBe(true);
    expect(
      pending(
        AppointmentType.THERAPY_SESSION,
        A.COMPLETED,
        SessionNoteStatus.COMPLETED,
      ),
    ).toBe(false);
    expect(pending(AppointmentType.THERAPY_SESSION, A.SCHEDULED, 'NONE')).toBe(
      false,
    );
    expect(pending(AppointmentType.ASSESSMENT, A.COMPLETED, 'NONE')).toBe(
      false,
    );
  });

  it('keeps actual times on the appointment’s day, in order and not ahead', () => {
    const dayStart = new Date('2026-10-26T18:00:00Z');
    const dayEnd = new Date('2026-10-27T18:00:00Z');
    const now = new Date('2026-10-27T06:00:00Z');
    const at = (iso: string) => new Date(iso);
    const errors = (t: {
      checkInAt?: string;
      actualStartAt?: string;
      actualEndAt?: string;
    }) =>
      attendanceTimeErrors(
        {
          checkInAt: t.checkInAt ? at(t.checkInAt) : null,
          actualStartAt: t.actualStartAt ? at(t.actualStartAt) : null,
          actualEndAt: t.actualEndAt ? at(t.actualEndAt) : null,
        },
        { now, dayStart, dayEnd },
      );
    expect(
      errors({
        checkInAt: '2026-10-27T03:50:00Z',
        actualStartAt: '2026-10-27T04:00:00Z',
        actualEndAt: '2026-10-27T04:45:00Z',
      }),
    ).toEqual({});
    expect(
      errors({
        actualStartAt: '2026-10-27T04:45:00Z',
        actualEndAt: '2026-10-27T04:00:00Z',
      }),
    ).toEqual({ actualEndAt: 'Must be after the session started' });
    expect(errors({ checkInAt: '2026-10-26T10:00:00Z' })).toEqual({
      checkInAt: 'Must be on the day of the appointment',
    });
    expect(errors({ actualEndAt: '2026-10-27T09:00:00Z' })).toEqual({
      actualEndAt: 'Can’t be in the future',
    });
  });
});
