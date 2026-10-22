import { Module } from '@nestjs/common';

import { GuardiansService } from './guardians.service';
import { GuardiansController, PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

@Module({
  controllers: [PatientsController, GuardiansController],
  providers: [PatientsService, GuardiansService],
  // For assessments, bookings, plans and billing to look patients up.
  exports: [PatientsService],
})
export class PatientsModule {}
