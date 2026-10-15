import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import {
  CentersController,
  RegistrationController,
} from './centers.controller';
import { CentersService } from './centers.service';

@Module({
  imports: [AuthModule],
  controllers: [RegistrationController, CentersController],
  providers: [CentersService],
  exports: [CentersService],
})
export class CentersModule {}
