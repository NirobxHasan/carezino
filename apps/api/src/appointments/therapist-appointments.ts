import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type {
  BookedAppointment,
  TherapistAppointments,
} from '../therapists/appointments.port';
import { BLOCKING_STATUSES } from './rules';

/**
 * The real THERAPIST_APPOINTMENTS lookup, bound by TherapistsModule. It only reads
 * Appointment rows, so therapist management doesn't depend on the booking services.
 */
@Injectable()
export class PrismaTherapistAppointments implements TherapistAppointments {
  constructor(private readonly prisma: PrismaService) {}

  overlapping(
    centerId: string,
    therapistId: string,
    from: Date,
    to?: Date,
  ): Promise<BookedAppointment[]> {
    return this.prisma.appointment.findMany({
      where: {
        centerId,
        therapistId,
        status: { in: BLOCKING_STATUSES },
        endAt: { gt: from },
        ...(to && { startAt: { lt: to } }),
      },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        type: true,
        patient: { select: { id: true, code: true, fullName: true } },
        therapyType: {
          select: { id: true, code: true, name: true, color: true },
        },
      },
      orderBy: { startAt: 'asc' },
    });
  }
}
