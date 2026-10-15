import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CsrfGuard, PermissionsGuard, SessionGuard } from './guards';
import { PasswordService } from './password.service';
import { SessionsService } from './sessions.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionsService,
    PasswordService,
    CsrfGuard,
    SessionGuard,
    PermissionsGuard,
  ],
  exports: [
    AuthService,
    SessionsService,
    PasswordService,
    CsrfGuard,
    SessionGuard,
    PermissionsGuard,
  ],
})
export class AuthModule {}
