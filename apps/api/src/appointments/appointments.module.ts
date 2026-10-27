import { Module } from '@nestjs/common';

import { CenterSettingsModule } from '../center-settings/center-settings.module';
import { PackagesModule } from '../packages/packages.module';
import { SessionsModule } from '../sessions/sessions.module';
import { TherapistsModule } from '../therapists/therapists.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { BookingService } from './booking.service';
import { SeriesController } from './series.controller';
import { SeriesService } from './series.service';

@Module({
  // SessionsModule completes appointments and marks no-shows (sessions.port.ts).
  imports: [
    CenterSettingsModule,
    TherapistsModule,
    PackagesModule,
    SessionsModule,
  ],
  controllers: [AppointmentsController, SeriesController],
  providers: [BookingService, AppointmentsService, SeriesService],
})
export class AppointmentsModule {}
