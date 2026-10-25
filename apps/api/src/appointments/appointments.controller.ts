import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import type { TenantContext } from '../auth/auth-context';
import { RequirePermissions, Tenant } from '../auth/decorators';
import { AppointmentsService } from './appointments.service';
import {
  AvailableSlotsQuery,
  CalendarQuery,
  CancelAppointmentDto,
  ChangeAppointmentPackageDto,
  ChangeAppointmentStatusDto,
  CreateAppointmentDto,
  ListAppointmentsQuery,
  RescheduleAppointmentDto,
  UpdateAppointmentDto,
} from './dto';

/**
 * Appointments of the active center. Reads need appointments.read_own at least; the
 * service then shows everything (appointments.read) or only the caller's own sessions.
 * Static routes come before :id.
 */
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  /** Bookable start times for one therapist, day and length. Front desk only. */
  @Get('available-slots')
  @RequirePermissions('appointments.read')
  availableSlots(
    @Tenant() tenant: TenantContext,
    @Query() query: AvailableSlotsQuery,
  ) {
    return this.appointments.availableSlots(tenant, query);
  }

  @Get('calendar')
  @RequirePermissions('appointments.read_own')
  calendar(@Tenant() tenant: TenantContext, @Query() query: CalendarQuery) {
    return this.appointments.calendar(tenant, query);
  }

  @Get()
  @RequirePermissions('appointments.read_own')
  list(@Tenant() tenant: TenantContext, @Query() query: ListAppointmentsQuery) {
    return this.appointments.list(tenant, query);
  }

  @Post()
  @RequirePermissions('appointments.read', 'appointments.create')
  create(@Tenant() tenant: TenantContext, @Body() dto: CreateAppointmentDto) {
    return this.appointments.create(tenant, dto);
  }

  @Get(':id')
  @RequirePermissions('appointments.read_own')
  get(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.appointments.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions('appointments.read_own', 'appointments.update')
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
  ) {
    return this.appointments.update(tenant, id, dto);
  }

  /** Changing the therapy type as well needs appointments.update (checked by the service). */
  @Patch(':id/reschedule')
  @RequirePermissions('appointments.read', 'appointments.reschedule')
  reschedule(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleAppointmentDto,
  ) {
    return this.appointments.reschedule(tenant, id, dto);
  }

  /** Late cancellations also need appointments.cancel_late (checked by the service). */
  @Patch(':id/cancel')
  @RequirePermissions('appointments.read_own', 'appointments.cancel')
  cancel(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAppointmentDto,
  ) {
    return this.appointments.cancel(tenant, id, dto);
  }

  /** Which package pays for an open appointment; null takes it off its package. */
  @Patch(':id/package')
  @RequirePermissions(
    'appointments.read',
    'appointments.update',
    'package_enrollments.read',
  )
  setPackage(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeAppointmentPackageDto,
  ) {
    return this.appointments.setPackage(tenant, id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('appointments.read_own', 'appointments.manage_status')
  setStatus(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeAppointmentStatusDto,
  ) {
    return this.appointments.setStatus(tenant, id, dto);
  }
}
