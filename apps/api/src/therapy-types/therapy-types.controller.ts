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
import {
  ChangeTherapyTypeStatusDto,
  CreateDurationOptionDto,
  CreateTherapyTypeDto,
  ListTherapyTypesQuery,
  ReorderTherapyTypesDto,
  UpdateDurationOptionDto,
  UpdateTherapyTypeDto,
} from './dto';
import { TherapyTypesService } from './therapy-types.service';

/** The center's therapy services. Responses include each type's duration options. */
@Controller('therapy-types')
export class TherapyTypesController {
  constructor(private readonly therapyTypes: TherapyTypesService) {}

  @Get()
  @RequirePermissions('therapy_types.read')
  list(@Tenant() tenant: TenantContext, @Query() query: ListTherapyTypesQuery) {
    return this.therapyTypes.list(tenant, query);
  }

  @Post()
  @RequirePermissions('therapy_types.create')
  create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateTherapyTypeDto,
    @Req() req: Request,
  ) {
    return this.therapyTypes.create(tenant, dto, requestMeta(req).ipAddress);
  }

  /** Adds the standard therapy types (OT, ABA, SLT) the center doesn't have yet. */
  @Post('defaults')
  @HttpCode(200)
  @RequirePermissions('therapy_types.create')
  addDefaults(@Tenant() tenant: TenantContext, @Req() req: Request) {
    return this.therapyTypes.addDefaults(tenant, requestMeta(req).ipAddress);
  }

  @Put('order')
  @RequirePermissions('therapy_types.update')
  reorder(
    @Tenant() tenant: TenantContext,
    @Body() dto: ReorderTherapyTypesDto,
    @Req() req: Request,
  ) {
    return this.therapyTypes.reorder(
      tenant,
      dto.ids,
      requestMeta(req).ipAddress,
    );
  }

  @Get(':id')
  @RequirePermissions('therapy_types.read')
  get(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.therapyTypes.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions('therapy_types.update')
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTherapyTypeDto,
    @Req() req: Request,
  ) {
    return this.therapyTypes.update(
      tenant,
      id,
      dto,
      requestMeta(req).ipAddress,
    );
  }

  @Patch(':id/status')
  @RequirePermissions('therapy_types.update')
  setStatus(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeTherapyTypeStatusDto,
    @Req() req: Request,
  ) {
    return this.therapyTypes.setStatus(
      tenant,
      id,
      dto.isActive,
      requestMeta(req).ipAddress,
    );
  }

  /** Only for therapy types nothing refers to; otherwise 409 IN_USE (deactivate instead). */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('therapy_types.delete')
  async remove(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.therapyTypes.remove(tenant, id, requestMeta(req).ipAddress);
  }

  @Get(':id/durations')
  @RequirePermissions('therapy_types.read')
  durations(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.therapyTypes.listDurations(tenant, id);
  }

  /** Duration writes return the whole therapy type, since the default may move. */
  @Post(':id/durations')
  @RequirePermissions('therapy_types.update')
  addDuration(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDurationOptionDto,
    @Req() req: Request,
  ) {
    return this.therapyTypes.addDuration(
      tenant,
      id,
      dto,
      requestMeta(req).ipAddress,
    );
  }

  @Patch(':id/durations/:durationId')
  @RequirePermissions('therapy_types.update')
  updateDuration(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('durationId', ParseUUIDPipe) durationId: string,
    @Body() dto: UpdateDurationOptionDto,
    @Req() req: Request,
  ) {
    return this.therapyTypes.updateDuration(
      tenant,
      id,
      durationId,
      dto,
      requestMeta(req).ipAddress,
    );
  }

  @Delete(':id/durations/:durationId')
  @RequirePermissions('therapy_types.update')
  removeDuration(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('durationId', ParseUUIDPipe) durationId: string,
    @Req() req: Request,
  ) {
    return this.therapyTypes.removeDuration(
      tenant,
      id,
      durationId,
      requestMeta(req).ipAddress,
    );
  }
}
