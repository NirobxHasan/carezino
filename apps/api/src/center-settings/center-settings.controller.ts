import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { requestMeta, type TenantContext } from '../auth/auth-context';
import { RequirePermissions, Tenant } from '../auth/decorators';
import { ClosuresService } from './closures.service';
import {
  CreateClosureDto,
  ListClosuresQuery,
  UpdateClosureDto,
  UpdateGeneralSettingsDto,
  UpdateSchedulingSettingsDto,
  UpdateWorkingHoursDto,
} from './dto';
import { SettingsService } from './settings.service';
import { WorkingHoursService } from './working-hours.service';

/** Operational configuration of the active center. */
@Controller('settings')
export class CenterSettingsController {
  constructor(
    private readonly workingHours: WorkingHoursService,
    private readonly closures: ClosuresService,
    private readonly settings: SettingsService,
  ) {}

  @Get('working-hours')
  @RequirePermissions('center_settings.read')
  getWorkingHours(@Tenant() tenant: TenantContext) {
    return this.workingHours.get(tenant);
  }

  @Put('working-hours')
  @RequirePermissions('center_settings.update')
  replaceWorkingHours(
    @Tenant() tenant: TenantContext,
    @Body() dto: UpdateWorkingHoursDto,
    @Req() req: Request,
  ) {
    return this.workingHours.replace(tenant, dto, requestMeta(req).ipAddress);
  }

  @Get('closures')
  @RequirePermissions('center_settings.read')
  listClosures(
    @Tenant() tenant: TenantContext,
    @Query() query: ListClosuresQuery,
  ) {
    return this.closures.list(tenant, query);
  }

  @Get('closures/:id')
  @RequirePermissions('center_settings.read')
  getClosure(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.closures.get(tenant, id);
  }

  @Post('closures')
  @RequirePermissions('center_settings.update')
  createClosure(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateClosureDto,
    @Req() req: Request,
  ) {
    return this.closures.create(tenant, dto, requestMeta(req).ipAddress);
  }

  @Patch('closures/:id')
  @RequirePermissions('center_settings.update')
  updateClosure(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClosureDto,
    @Req() req: Request,
  ) {
    return this.closures.update(tenant, id, dto, requestMeta(req).ipAddress);
  }

  @Delete('closures/:id')
  @HttpCode(204)
  @RequirePermissions('center_settings.update')
  async removeClosure(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.closures.remove(tenant, id, requestMeta(req).ipAddress);
  }

  @Get('scheduling')
  @RequirePermissions('center_settings.read')
  getScheduling(@Tenant() tenant: TenantContext) {
    return this.settings.getScheduling(tenant);
  }

  @Patch('scheduling')
  @RequirePermissions('center_settings.update')
  updateScheduling(
    @Tenant() tenant: TenantContext,
    @Body() dto: UpdateSchedulingSettingsDto,
    @Req() req: Request,
  ) {
    return this.settings.updateScheduling(
      tenant,
      dto,
      requestMeta(req).ipAddress,
    );
  }

  @Get('general')
  @RequirePermissions('center_settings.read')
  getGeneral(@Tenant() tenant: TenantContext) {
    return this.settings.getGeneral(tenant);
  }

  @Patch('general')
  @RequirePermissions('center_settings.update')
  updateGeneral(
    @Tenant() tenant: TenantContext,
    @Body() dto: UpdateGeneralSettingsDto,
    @Req() req: Request,
  ) {
    return this.settings.updateGeneral(tenant, dto, requestMeta(req).ipAddress);
  }
}
