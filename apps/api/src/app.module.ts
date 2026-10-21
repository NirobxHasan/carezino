import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CsrfGuard, PermissionsGuard, SessionGuard } from './auth/guards';
import { throttlerOptions } from './auth/throttle';
import { CenterSettingsModule } from './center-settings/center-settings.module';
import { CentersModule } from './centers/centers.module';
import { CommonModule } from './common/common.module';
import { PlatformModule } from './platform/platform.module';
import { PrismaModule } from './prisma/prisma.module';
import { StaffModule } from './staff/staff.module';
import { TherapyTypesModule } from './therapy-types/therapy-types.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot(throttlerOptions),
    PrismaModule,
    CommonModule,
    AuthModule,
    StaffModule,
    CentersModule,
    PlatformModule,
    TherapyTypesModule,
    CenterSettingsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global guards run in this order: rate limit, CSRF, authenticate, authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: CsrfGuard },
    { provide: APP_GUARD, useExisting: SessionGuard },
    { provide: APP_GUARD, useExisting: PermissionsGuard },
  ],
})
export class AppModule {}
