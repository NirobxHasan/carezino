import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import {
  requestMeta,
  type AuthContext,
  type TenantContext,
} from '../auth/auth-context';
import {
  OptionalAuth,
  Public,
  RequirePermissions,
  Tenant,
} from '../auth/decorators';
import { AuthService } from '../auth/auth.service';
import { SessionsService } from '../auth/sessions.service';
import { SENSITIVE_THROTTLE } from '../auth/throttle';
import {
  AcceptInvitationDto,
  ChangeRoleDto,
  ChangeStatusDto,
  InviteStaffDto,
  ListStaffQuery,
} from './dto';
import { InvitationsService } from './invitations.service';
import { StaffService } from './staff.service';

/** Declared before StaffController so /staff/invitations isn't captured by /staff/:id. */
@Controller('staff/invitations')
export class StaffInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @RequirePermissions('staff.read')
  list(@Tenant() tenant: TenantContext) {
    return this.invitations.listOpen(tenant);
  }

  @Post()
  @RequirePermissions('staff.create', 'staff.assign_role')
  invite(
    @Tenant() tenant: TenantContext,
    @Body() dto: InviteStaffDto,
    @Req() req: Request,
  ) {
    return this.invitations.invite(tenant, dto, requestMeta(req).ipAddress);
  }

  @Post(':id/resend')
  @HttpCode(200)
  @RequirePermissions('staff.create')
  resend(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.invitations.resend(tenant, id, requestMeta(req).ipAddress);
  }

  @Post(':id/revoke')
  @HttpCode(204)
  @RequirePermissions('staff.create')
  async revoke(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.invitations.revoke(tenant, id, requestMeta(req).ipAddress);
  }
}

@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermissions('staff.read')
  list(@Tenant() tenant: TenantContext, @Query() query: ListStaffQuery) {
    return this.staff.list(tenant, query);
  }

  @Get(':id')
  @RequirePermissions('staff.read')
  get(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.get(tenant, id);
  }

  @Patch(':id/role')
  @RequirePermissions('staff.assign_role')
  changeRole(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeRoleDto,
    @Req() req: Request,
  ) {
    return this.staff.changeRole(
      tenant,
      id,
      dto.role,
      requestMeta(req).ipAddress,
    );
  }

  /** Activation needs staff.update and deactivation staff.deactivate; the service checks which. */
  @Patch(':id/status')
  @RequirePermissions('staff.read')
  changeStatus(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
    @Req() req: Request,
  ) {
    return this.staff.changeStatus(
      tenant,
      id,
      dto.status,
      requestMeta(req).ipAddress,
    );
  }
}

/** Public endpoints used by the invitation link. */
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly sessions: SessionsService,
    private readonly auth: AuthService,
  ) {}

  @Public()
  @Throttle(SENSITIVE_THROTTLE)
  @Post('preview')
  @HttpCode(200)
  preview(@Body('token') token: unknown) {
    return this.invitations.preview(
      typeof token === 'string' ? token.slice(0, 200) : '',
    );
  }

  @Public()
  @Throttle(SENSITIVE_THROTTLE)
  @Post('accept')
  @HttpCode(200)
  async accept(
    @Body() dto: AcceptInvitationDto,
    @OptionalAuth() current: AuthContext | null,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.invitations.accept(
      dto,
      current,
      requestMeta(req).ipAddress,
    );
    if (result.createdAccount) {
      // New account: sign them in, replacing any session this browser had.
      await this.auth.startSession(req, res, result.userId, {
        remember: false,
        centerId: result.centerId,
      });
    } else {
      // Existing user, signed in as themself: start working in the inviting center.
      await this.sessions.switchCenter(
        current!.sessionId,
        result.userId,
        result.centerId,
      );
    }
    return { centerId: result.centerId };
  }
}
