import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { AppConfig } from '../config/app-config';
import type { AuthContext, AuthenticatedRequest } from './auth-context';
import { AuthService } from './auth.service';
import { CSRF_COOKIE, issueCsrfCookie } from './cookies';
import { CurrentAuth, OptionalAuth, Public } from './decorators';
import {
  AdminLoginDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from './dto';
import { CREDENTIAL_THROTTLE, SENSITIVE_THROTTLE } from './throttle';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  /** Makes sure the browser has a CSRF cookie before its first state-changing request. */
  @Public()
  @Get('csrf')
  @HttpCode(204)
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!(req.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE]) {
      issueCsrfCookie(res, this.config.cookieSecure);
    }
  }

  @Public()
  @Throttle(CREDENTIAL_THROTTLE)
  @Post('login')
  @HttpCode(204)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.login(dto, req, res);
  }

  /** Super admin sign-in at /admin/login. */
  @Public()
  @Throttle(CREDENTIAL_THROTTLE)
  @Post('admin/login')
  @HttpCode(204)
  async adminLogin(
    @Body() dto: AdminLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.adminLogin(dto, req, res);
  }

  /** Public so a stale or expired cookie can still be cleared. */
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(req, res);
  }

  @Get('me')
  me(@CurrentAuth() auth: AuthContext) {
    return this.auth.me(auth);
  }

  /**
   * Like GET /auth/me, but answers 200 with `{ me: null }` when signed out, so the web
   * app can check for a session without an error response.
   */
  @Public()
  @Get('session')
  async session(@OptionalAuth() auth: AuthContext | null) {
    return { me: auth ? await this.auth.me(auth) : null };
  }

  /** Name and mobile only. Email changes need a verification flow that doesn't exist yet. */
  @Patch('me')
  async updateMe(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: UpdateProfileDto,
  ) {
    await this.auth.updateProfile(auth, dto);
    return this.auth.me(auth);
  }

  @Public()
  @Throttle(SENSITIVE_THROTTLE)
  @Post('forgot-password')
  @HttpCode(202)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    return {
      message:
        'If an account exists for that email, we’ve sent instructions to reset the password.',
    };
  }

  @Public()
  @Throttle(CREDENTIAL_THROTTLE)
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto);
  }

  @Throttle(CREDENTIAL_THROTTLE)
  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.auth.changePassword(auth, dto);
  }
}
