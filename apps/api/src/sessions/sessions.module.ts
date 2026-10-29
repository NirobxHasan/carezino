import { Module } from '@nestjs/common';

import { SESSION_OUTCOMES } from '../appointments/sessions.port';
import { BillingModule } from '../billing/billing.module';
import { CenterSettingsModule } from '../center-settings/center-settings.module';
import { PackagesModule } from '../packages/packages.module';
import { SessionLifecycle } from './lifecycle.service';
import { SessionNotesService } from './notes.service';
import {
  AppointmentAttendanceController,
  MySessionsController,
  PatientSessionsController,
  SessionsController,
} from './sessions.controller';
import { SessionsService } from './sessions.service';
import { NoteTemplatesController } from './templates.controller';
import { NoteTemplatesService } from './templates.service';

@Module({
  // BillingModule invoices completed sessions when the center's policy says so.
  imports: [CenterSettingsModule, PackagesModule, BillingModule],
  controllers: [
    SessionsController,
    AppointmentAttendanceController,
    MySessionsController,
    PatientSessionsController,
    NoteTemplatesController,
  ],
  providers: [
    SessionLifecycle,
    SessionsService,
    SessionNotesService,
    NoteTemplatesService,
    { provide: SESSION_OUTCOMES, useExisting: SessionLifecycle },
  ],
  // Appointment status changes (complete, no-show) go through the session lifecycle.
  exports: [SESSION_OUTCOMES],
})
export class SessionsModule {}
