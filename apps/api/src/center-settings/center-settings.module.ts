import { Module } from '@nestjs/common';

import { CenterSettingsController } from './center-settings.controller';
import { ClosuresService } from './closures.service';
import { SettingsService } from './settings.service';
import { WorkingHoursService } from './working-hours.service';

@Module({
  controllers: [CenterSettingsController],
  providers: [WorkingHoursService, ClosuresService, SettingsService],
  exports: [WorkingHoursService, ClosuresService, SettingsService],
})
export class CenterSettingsModule {}
