import { Module } from '@nestjs/common';

import { CenterSettingsModule } from '../center-settings/center-settings.module';
import { CategoriesService } from './categories.service';
import { GoalsService } from './goals.service';
import { PlansService } from './plans.service';
import { ReviewsService } from './reviews.service';
import { PlanWrites } from './shared';
import {
  GoalCategoriesController,
  PatientTherapyPlansController,
  TherapyPlansController,
} from './therapy-plans.controller';

@Module({
  imports: [CenterSettingsModule],
  controllers: [
    TherapyPlansController,
    PatientTherapyPlansController,
    GoalCategoriesController,
  ],
  providers: [
    PlanWrites,
    PlansService,
    GoalsService,
    ReviewsService,
    CategoriesService,
  ],
})
export class TherapyPlansModule {}
