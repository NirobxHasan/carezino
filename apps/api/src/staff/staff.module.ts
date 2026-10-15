import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { InvitationsService } from './invitations.service';
import {
  InvitationsController,
  StaffController,
  StaffInvitationsController,
} from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [AuthModule],
  // Order matters: /staff/invitations must be registered before /staff/:id.
  controllers: [
    StaffInvitationsController,
    StaffController,
    InvitationsController,
  ],
  providers: [StaffService, InvitationsService],
  exports: [InvitationsService],
})
export class StaffModule {}
