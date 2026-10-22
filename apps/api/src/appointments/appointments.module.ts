import { Module } from '@nestjs/common';

import { CenterSettingsModule } from '../center-settings/center-settings.module';
import { TherapistsModule } from '../therapists/therapists.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { BookingService } from './booking.service';
import { SeriesController } from './series.controller';
import { SeriesService } from './series.service';

@Module({
  imports: [CenterSettingsModule, TherapistsModule],
  controllers: [AppointmentsController, SeriesController],
  providers: [BookingService, AppointmentsService, SeriesService],
})
export class AppointmentsModule {}
