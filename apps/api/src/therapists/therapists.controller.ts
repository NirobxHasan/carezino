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
import { AvailabilityService } from './availability.service';
import {
  ChangeTherapistStatusDto,
  CreateTherapistDto,
  CreateTimeOffDto,
  ListTherapistsQuery,
  ListTimeOffQuery,
  ScheduleQuery,
  SpecializationsDto,
  UpdateAvailabilityDto,
  UpdateTherapistDto,
  UpdateTimeOffDto,
} from './dto';
import { ScheduleService } from './schedule.service';
import { TherapistsService } from './therapists.service';
import { TimeOffService } from './time-off.service';

/**
 * Therapist profiles of the active center. Reads need therapists.read_own at least; the
 * services then show everyone (therapists.read) or only the caller's own linked profile.
 */
@Controller('therapists')
export class TherapistsController {
  constructor(
    private readonly therapists: TherapistsService,
    private readonly availability: AvailabilityService,
    private readonly timeOff: TimeOffService,
    private readonly schedule: ScheduleService,
  ) {}

  @Get()
  @RequirePermissions('therapists.read_own')
  list(@Tenant() tenant: TenantContext, @Query() query: ListTherapistsQuery) {
    return this.therapists.list(tenant, query);
  }

  @Post()
  @RequirePermissions('therapists.create')
  create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateTherapistDto,
    @Req() req: Request,
  ) {
    return this.therapists.create(tenant, dto, requestMeta(req).ipAddress);
  }

  @Get(':id')
  @RequirePermissions('therapists.read_own')
  get(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.therapists.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions('therapists.update')
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTherapistDto,
    @Req() req: Request,
  ) {
    return this.therapists.update(tenant, id, dto, requestMeta(req).ipAddress);
  }

  /** Activation needs therapists.update and deactivation therapists.deactivate; the service checks which. */
  @Patch(':id/status')
  @RequirePermissions('therapists.read')
  setStatus(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeTherapistStatusDto,
    @Req() req: Request,
  ) {
    return this.therapists.setStatus(
      tenant,
      id,
      dto.status,
      requestMeta(req).ipAddress,
    );
  }

  /** Soft delete: hidden everywhere, kept for the records that refer to it. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('therapists.delete')
  async remove(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.therapists.remove(tenant, id, requestMeta(req).ipAddress);
  }

  @Get(':id/specializations')
  @RequirePermissions('therapists.read_own')
  specializations(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.therapists.listSpecializations(tenant, id);
  }

  @Put(':id/specializations')
  @RequirePermissions('therapists.update')
  replaceSpecializations(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SpecializationsDto,
    @Req() req: Request,
  ) {
    return this.therapists.replaceSpecializations(
      tenant,
      id,
      dto,
      requestMeta(req).ipAddress,
    );
  }

  @Get(':id/availability')
  @RequirePermissions('therapists.read_own')
  getAvailability(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.availability.get(tenant, id);
  }

  @Put(':id/availability')
  @RequirePermissions('therapists.manage_availability')
  replaceAvailability(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAvailabilityDto,
    @Req() req: Request,
  ) {
    return this.availability.replace(
      tenant,
      id,
      dto.days,
      requestMeta(req).ipAddress,
    );
  }

  @Get(':id/time-off')
  @RequirePermissions('therapists.read_own')
  listTimeOff(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListTimeOffQuery,
  ) {
    return this.timeOff.list(tenant, id, query);
  }

  @Post(':id/time-off')
  @RequirePermissions('therapists.manage_time_off')
  addTimeOff(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTimeOffDto,
    @Req() req: Request,
  ) {
    return this.timeOff.create(tenant, id, dto, requestMeta(req).ipAddress);
  }

  @Patch(':id/time-off/:timeOffId')
  @RequirePermissions('therapists.manage_time_off')
  updateTimeOff(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('timeOffId', ParseUUIDPipe) timeOffId: string,
    @Body() dto: UpdateTimeOffDto,
    @Req() req: Request,
  ) {
    return this.timeOff.update(
      tenant,
      id,
      timeOffId,
      dto,
      requestMeta(req).ipAddress,
    );
  }

  @Delete(':id/time-off/:timeOffId')
  @HttpCode(204)
  @RequirePermissions('therapists.manage_time_off')
  async removeTimeOff(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('timeOffId', ParseUUIDPipe) timeOffId: string,
    @Req() req: Request,
  ) {
    await this.timeOff.remove(
      tenant,
      id,
      timeOffId,
      requestMeta(req).ipAddress,
    );
  }

  /** Working windows per day; not bookable slots (see ScheduleService). */
  @Get(':id/schedule')
  @RequirePermissions('therapists.read_own')
  getSchedule(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ScheduleQuery,
  ) {
    return this.schedule.overview(tenant, id, query.startDate, query.endDate);
  }
}
