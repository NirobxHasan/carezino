import { Injectable } from '@nestjs/common';

import type {
  AppointmentStatus,
  AppointmentType,
} from '../generated/prisma/enums';

/** A booked appointment, as far as therapist scheduling needs to know. */
export interface BookedAppointment {
  id: string;
  startAt: Date;
  endAt: Date;
  status: AppointmentStatus;
  type: AppointmentType;
  patient: { id: string; code: string; fullName: string };
  therapyType: { id: string; code: string; name: string; color: string | null };
}

/**
 * How therapist management asks about appointments without depending on the booking
 * module. Results are null while no appointment module is installed: callers must treat
 * that as "not checked", never as "no conflicts".
 */
export interface TherapistAppointments {
  /**
   * The therapist's appointments that hold time (scheduled, confirmed or completed)
   * overlapping [from, to), earliest first; open-ended without `to`.
   */
  overlapping(
    centerId: string,
    therapistId: string,
    from: Date,
    to?: Date,
  ): Promise<BookedAppointment[] | null>;
}

export const THERAPIST_APPOINTMENTS = Symbol('THERAPIST_APPOINTMENTS');

/**
 * Reports that nothing was checked rather than inventing results. The app binds the real
 * lookup (appointments/therapist-appointments.ts); this stays for tests and for running
 * therapist scheduling without the appointments module.
 */
@Injectable()
export class AppointmentsNotInstalled implements TherapistAppointments {
  overlapping() {
    return Promise.resolve(null);
  }
}
