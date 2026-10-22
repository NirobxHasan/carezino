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
  ChangePatientStatusDto,
  CreatePatientDto,
  LinkGuardianDto,
  ListPatientsQuery,
  RecordConsentDto,
  SearchGuardiansQuery,
  SetPrimaryContactDto,
  UpdateGuardianDto,
  UpdatePatientDto,
  UpdatePatientGuardianDto,
} from './dto';
import { GuardiansService } from './guardians.service';
import { PatientsService } from './patients.service';

/** Patients of the active center, with their contacts, therapy interests and consent. */
@Controller('patients')
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly guardians: GuardiansService,
  ) {}

  @Get()
  @RequirePermissions('patients.read')
  list(@Tenant() tenant: TenantContext, @Query() query: ListPatientsQuery) {
    return this.patients.list(tenant, query);
  }

  /** A new guardian also needs guardians.create, an existing one guardians.read (checked by the service). */
  @Post()
  @RequirePermissions('patients.create')
  create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreatePatientDto,
    @Req() req: Request,
  ) {
    return this.patients.create(tenant, dto, requestMeta(req).ipAddress);
  }

  @Get(':id')
  @RequirePermissions('patients.read')
  get(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.patients.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions('patients.update')
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePatientDto,
    @Req() req: Request,
  ) {
    return this.patients.update(tenant, id, dto, requestMeta(req).ipAddress);
  }

  @Patch(':id/status')
  @RequirePermissions('patients.change_status')
  setStatus(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangePatientStatusDto,
    @Req() req: Request,
  ) {
    return this.patients.setStatus(
      tenant,
      id,
      dto.status,
      requestMeta(req).ipAddress,
    );
  }

  /** Soft delete: hidden everywhere, kept for the records that refer to it. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('patients.delete')
  async remove(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.patients.remove(tenant, id, requestMeta(req).ipAddress);
  }

  @Post(':id/guardians')
  @RequirePermissions('patients.read', 'guardians.create')
  linkGuardian(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkGuardianDto,
    @Req() req: Request,
  ) {
    return this.guardians.link(tenant, id, dto, requestMeta(req).ipAddress);
  }

  @Patch(':id/guardians/:relationId')
  @RequirePermissions('patients.read', 'guardians.update')
  updateGuardianLink(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('relationId', ParseUUIDPipe) relationId: string,
    @Body() dto: UpdatePatientGuardianDto,
    @Req() req: Request,
  ) {
    return this.guardians.updateLink(
      tenant,
      id,
      relationId,
      dto,
      requestMeta(req).ipAddress,
    );
  }

  /** Removes the relationship only, never the guardian. */
  @Delete(':id/guardians/:relationId')
  @RequirePermissions('patients.read', 'guardians.unlink')
  unlinkGuardian(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('relationId', ParseUUIDPipe) relationId: string,
    @Req() req: Request,
  ) {
    return this.guardians.unlink(
      tenant,
      id,
      relationId,
      requestMeta(req).ipAddress,
    );
  }

  @Put(':id/primary-contact')
  @RequirePermissions('patients.read', 'guardians.update')
  setPrimaryContact(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPrimaryContactDto,
    @Req() req: Request,
  ) {
    return this.guardians.setPrimary(
      tenant,
      id,
      dto,
      requestMeta(req).ipAddress,
    );
  }

  @Post(':id/consents')
  @RequirePermissions('patients.update')
  recordConsent(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordConsentDto,
    @Req() req: Request,
  ) {
    return this.guardians.recordConsent(
      tenant,
      id,
      dto,
      requestMeta(req).ipAddress,
    );
  }
}

/** Guardians are reached through patients; these look them up and edit their own details. */
@Controller('guardians')
export class GuardiansController {
  constructor(private readonly guardians: GuardiansService) {}

  @Get('search')
  @RequirePermissions('guardians.read')
  search(
    @Tenant() tenant: TenantContext,
    @Query() query: SearchGuardiansQuery,
  ) {
    return this.guardians.search(tenant, query.q);
  }

  /** Changes what every patient linked to this guardian sees. */
  @Patch(':id')
  @RequirePermissions('guardians.update')
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGuardianDto,
    @Req() req: Request,
  ) {
    return this.guardians.updateGuardian(
      tenant,
      id,
      dto,
      requestMeta(req).ipAddress,
    );
  }
}
