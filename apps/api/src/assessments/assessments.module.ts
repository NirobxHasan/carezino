import { Module } from '@nestjs/common';

import {
  AssessmentsController,
  PatientAssessmentsController,
} from './assessments.controller';
import { AssessmentsService } from './assessments.service';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  controllers: [
    TemplatesController,
    AssessmentsController,
    PatientAssessmentsController,
  ],
  providers: [TemplatesService, AssessmentsService],
})
export class AssessmentsModule {}
