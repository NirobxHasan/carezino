import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import type { TenantContext } from '../auth/auth-context';
import { RequirePermissions, Tenant } from '../auth/decorators';
import { CancelSeriesDto, CreateSeriesDto, SeriesDto } from './dto';
import { SeriesService } from './series.service';

/** Recurring bookings: preview, book, view, and cancel what's left of one. */
@Controller('appointment-series')
export class SeriesController {
  constructor(private readonly series: SeriesService) {}

  /** Every date the rule would book and what stands in the way of each. Saves nothing. */
  @Post('preview')
  @HttpCode(200)
  @RequirePermissions(
    'appointments.read',
    'appointments.create',
    'appointments.manage_recurring',
  )
  preview(@Tenant() tenant: TenantContext, @Body() dto: SeriesDto) {
    return this.series.preview(tenant, dto);
  }

  @Post()
  @RequirePermissions(
    'appointments.read',
    'appointments.create',
    'appointments.manage_recurring',
  )
  create(@Tenant() tenant: TenantContext, @Body() dto: CreateSeriesDto) {
    return this.series.create(tenant, dto);
  }

  @Get(':id')
  @RequirePermissions('appointments.read_own')
  get(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.series.get(tenant, id);
  }

  @Post(':id/cancel-future')
  @HttpCode(200)
  @RequirePermissions(
    'appointments.read',
    'appointments.cancel',
    'appointments.manage_recurring',
  )
  cancelFuture(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelSeriesDto,
  ) {
    return this.series.cancelFuture(tenant, id, dto);
  }
}
