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
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { requestMeta, type TenantContext } from '../auth/auth-context';
import { RequirePermissions, Tenant } from '../auth/decorators';
import { CatalogService } from './catalog.service';
import {
  AdjustEnrollmentDto,
  CancelEnrollmentDto,
  CreateEnrollmentDto,
  CreatePackageDto,
  EnrollmentOptionsQuery,
  ListEnrollmentsQuery,
  ListPackagesQuery,
  PackageStatusDto,
  RenewEnrollmentDto,
  UpdatePackageDto,
} from './dto';
import { EnrollmentsService } from './enrollments.service';

const ip = (req: Request) => requestMeta(req).ipAddress;
const Id = (name = 'id') => Param(name, ParseUUIDPipe);

/** The center's package catalog. */
@Controller('packages')
export class PackagesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @RequirePermissions('packages.read')
  list(@Tenant() tenant: TenantContext, @Query() query: ListPackagesQuery) {
    return this.catalog.list(tenant, query);
  }

  @Post()
  @RequirePermissions('packages.read', 'packages.create')
  create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreatePackageDto,
    @Req() req: Request,
  ) {
    return this.catalog.create(tenant, dto, ip(req));
  }

  @Get(':id')
  @RequirePermissions('packages.read')
  get(@Tenant() tenant: TenantContext, @Id() id: string) {
    return this.catalog.get(tenant, id);
  }

  /** Future enrollments only: existing ones keep the terms they were bought on. */
  @Patch(':id')
  @RequirePermissions('packages.read', 'packages.update')
  update(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: UpdatePackageDto,
    @Req() req: Request,
  ) {
    return this.catalog.update(tenant, id, dto, ip(req));
  }

  @Patch(':id/status')
  @RequirePermissions('packages.read', 'packages.deactivate')
  setStatus(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: PackageStatusDto,
    @Req() req: Request,
  ) {
    return this.catalog.setStatus(tenant, id, dto, ip(req));
  }

  /** Only packages nobody has enrolled in. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('packages.read', 'packages.delete')
  remove(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Req() req: Request,
  ) {
    return this.catalog.remove(tenant, id, ip(req));
  }

  @Post(':id/duplicate')
  @RequirePermissions('packages.read', 'packages.create')
  duplicate(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Req() req: Request,
  ) {
    return this.catalog.duplicate(tenant, id, ip(req));
  }
}

/**
 * Patients' package enrollments. Discounts and other changes to the package's terms
 * also need package_enrollments.override_terms (checked by the service). Static routes
 * come before :id.
 */
@Controller('package-enrollments')
export class PackageEnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get()
  @RequirePermissions('package_enrollments.read')
  list(@Tenant() tenant: TenantContext, @Query() query: ListEnrollmentsQuery) {
    return this.enrollments.list(tenant, query);
  }

  /** A patient's packages that could pay for a session, for booking screens. */
  @Get('options')
  @RequirePermissions('package_enrollments.read')
  options(
    @Tenant() tenant: TenantContext,
    @Query() query: EnrollmentOptionsQuery,
  ) {
    return this.enrollments.options(tenant, query);
  }

  @Post()
  @RequirePermissions('package_enrollments.read', 'package_enrollments.create')
  create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateEnrollmentDto,
    @Req() req: Request,
  ) {
    return this.enrollments.create(tenant, dto, ip(req));
  }

  @Get(':id')
  @RequirePermissions('package_enrollments.read')
  get(@Tenant() tenant: TenantContext, @Id() id: string) {
    return this.enrollments.get(tenant, id);
  }

  @Get(':id/ledger')
  @RequirePermissions('package_enrollments.read')
  ledger(@Tenant() tenant: TenantContext, @Id() id: string) {
    return this.enrollments.ledger(tenant, id);
  }

  @Post(':id/renew')
  @RequirePermissions('package_enrollments.read', 'package_enrollments.renew')
  renew(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: RenewEnrollmentDto,
    @Req() req: Request,
  ) {
    return this.enrollments.renew(tenant, id, dto, ip(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('package_enrollments.read', 'package_enrollments.cancel')
  cancel(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: CancelEnrollmentDto,
    @Req() req: Request,
  ) {
    return this.enrollments.cancel(tenant, id, dto, ip(req));
  }

  @Post(':id/adjust')
  @HttpCode(200)
  @RequirePermissions('package_enrollments.read', 'package_enrollments.adjust')
  adjust(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: AdjustEnrollmentDto,
    @Req() req: Request,
  ) {
    return this.enrollments.adjust(tenant, id, dto, ip(req));
  }
}

@Controller('patients')
export class PatientPackagesController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get(':id/package-enrollments')
  @RequirePermissions('package_enrollments.read')
  list(@Tenant() tenant: TenantContext, @Id() id: string) {
    return this.enrollments.patientEnrollments(tenant, id);
  }
}
