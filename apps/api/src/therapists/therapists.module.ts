import { Module } from '@nestjs/common';

import { PrismaTherapistAppointments } from '../appointments/therapist-appointments';
import { CenterSettingsModule } from '../center-settings/center-settings.module';
import { THERAPIST_APPOINTMENTS } from './appointments.port';
import { AvailabilityService } from './availability.service';
import { ScheduleService } from './schedule.service';
import { TherapistsController } from './therapists.controller';
import { TherapistsService } from './therapists.service';
import { TimeOffService } from './time-off.service';

@Module({
  imports: [CenterSettingsModule],
  controllers: [TherapistsController],
  providers: [
    TherapistsService,
    AvailabilityService,
    TimeOffService,
    ScheduleService,
    // Reads Appointment rows directly, so this module needn't import AppointmentsModule
    // (which imports this one for ScheduleService).
    { provide: THERAPIST_APPOINTMENTS, useClass: PrismaTherapistAppointments },
  ],
  // Booking builds on ScheduleService.facts.
  exports: [TherapistsService, ScheduleService],
})
export class TherapistsModule {}
