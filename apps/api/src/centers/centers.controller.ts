import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
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
import { AuthService } from '../auth/auth.service';
import {
  CurrentAuth,
  Public,
  RequirePermissions,
  Tenant,
} from '../auth/decorators';
import { RegisterCenterDto } from '../auth/dto';
import { SessionsService } from '../auth/sessions.service';
import { SENSITIVE_THROTTLE } from '../auth/throttle';
import { apiError } from '../common/errors';
import { AppConfig } from '../config/app-config';
import { CentersService, assertOwnerPasswordsMatch } from './centers.service';
import { SwitchCenterDto, UpdateCenterDto } from './dto';

@Controller('auth')
export class RegistrationController {
  constructor(
    private readonly centers: CentersService,
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('registration')
  registration() {
    return { enabled: this.config.publicRegistrationEnabled };
  }

  /** Public center signup. Creates the center and its owner, then signs the owner in. */
  @Public()
  @Throttle(SENSITIVE_THROTTLE)
  @Post('register-center')
  async register(
    @Body() dto: RegisterCenterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.config.publicRegistrationEnabled) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'New center registration is closed. Contact Carezino to set up your center.',
        'REGISTRATION_CLOSED',
      );
    }
    assertOwnerPasswordsMatch(dto.owner);
    const { center, userId } = await this.centers.register(
      dto.center,
      dto.owner,
      {
        ipAddress: requestMeta(req).ipAddress,
        via: 'public_registration',
        defaultTherapyTypes: dto.defaultTherapyTypes,
      },
    );
    await this.auth.startSession(req, res, userId, {
      remember: false,
      centerId: center.id,
    });
    return { center };
  }
}

@Controller('centers')
export class CentersController {
  constructor(
    private readonly centers: CentersService,
    private readonly sessions: SessionsService,
  ) {}

  @Get('current')
  @RequirePermissions('center.read')
  current(@Tenant() tenant: TenantContext) {
    return this.centers.getCurrent(tenant);
  }

  @Patch('current')
  @RequirePermissions('center.update')
  update(
    @Tenant() tenant: TenantContext,
    @Body() dto: UpdateCenterDto,
    @Req() req: Request,
  ) {
    return this.centers.updateCurrent(tenant, dto, requestMeta(req).ipAddress);
  }

  @Get('my')
  my(@CurrentAuth() auth: AuthContext) {
    return this.centers.listForUser(auth.user.id);
  }

  /** Changes the session's active center. Only centers with an active membership are allowed. */
  @Post('switch')
  @HttpCode(204)
  async switch(@CurrentAuth() auth: AuthContext, @Body() dto: SwitchCenterDto) {
    const ok = await this.sessions.switchCenter(
      auth.sessionId,
      auth.user.id,
      dto.centerId,
    );
    if (!ok) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'You don’t have access to that center',
        'NO_CENTER_ACCESS',
      );
    }
  }
}
