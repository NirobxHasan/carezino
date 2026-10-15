import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CentersModule } from '../centers/centers.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [AuthModule, CentersModule],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
