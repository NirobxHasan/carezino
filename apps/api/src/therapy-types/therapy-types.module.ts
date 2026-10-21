import { Module } from '@nestjs/common';

import { TherapyTypesController } from './therapy-types.controller';
import { TherapyTypesService } from './therapy-types.service';

@Module({
  controllers: [TherapyTypesController],
  providers: [TherapyTypesService],
  exports: [TherapyTypesService],
})
export class TherapyTypesModule {}
