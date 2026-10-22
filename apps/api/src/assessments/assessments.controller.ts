import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { requestMeta, type TenantContext } from '../auth/auth-context';
import { RequirePermissions, Tenant } from '../auth/decorators';
import { AssessmentsService } from './assessments.service';
import {
  AmendAssessmentDto,
  CompleteAssessmentDto,
  CreateAssessmentDto,
  ListAssessmentsQuery,
  PatientOptionsQuery,
  UpdateAssessmentDto,
} from './dto';

/**
 * Assessments of the active center. Reads need assessments.read_own at least; the
 * service decides which assessments the caller sees and whether with their clinical
 * content (access.ts). Writes are limited to the caller's own assessments. Static
 * routes come before :id.
 */
@Controller('assessments')
export class AssessmentsController {
  constructor(private readonly assessments: AssessmentsService) {}

  @Get()
  @RequirePermissions('assessments.read_own')
  list(@Tenant() tenant: TenantContext, @Query() query: ListAssessmentsQuery) {
    return this.assessments.list(tenant, query);
  }

  /** Patients the caller may start an assessment for. */
  @Get('patient-options')
  @RequirePermissions('assessments.create')
  patientOptions(
    @Tenant() tenant: TenantContext,
    @Query() query: PatientOptionsQuery,
  ) {
    return this.assessments.patientOptions(tenant, query);
  }

  @Post()
  @RequirePermissions('assessments.read_own', 'assessments.create')
  create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateAssessmentDto,
    @Req() req: Request,
  ) {
    return this.assessments.create(tenant, dto, requestMeta(req).ipAddress);
  }

  @Get(':id')
  @RequirePermissions('assessments.read_own')
  get(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.assessments.get(tenant, id);
  }

  /** The content before amendment `number`; number 1 holds the signed original. */
  @Get(':id/amendments/:number')
  @RequirePermissions('assessments.read_own')
  amendment(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('number', ParseIntPipe) number: number,
  ) {
    return this.assessments.amendment(tenant, id, number);
  }

  /** Saves a draft; required fields may still be empty. */
  @Patch(':id')
  @RequirePermissions('assessments.read_own', 'assessments.update_draft')
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssessmentDto,
  ) {
    return this.assessments.update(tenant, id, dto);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermissions('assessments.read_own', 'assessments.complete')
  complete(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteAssessmentDto,
    @Req() req: Request,
  ) {
    return this.assessments.complete(
      tenant,
      id,
      dto,
      requestMeta(req).ipAddress,
    );
  }

  @Post(':id/amend')
  @HttpCode(200)
  @RequirePermissions('assessments.read_own', 'assessments.amend')
  amend(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AmendAssessmentDto,
    @Req() req: Request,
  ) {
    return this.assessments.amend(tenant, id, dto, requestMeta(req).ipAddress);
  }

  /** Drafts only: completed assessments are never deleted. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('assessments.read_own', 'assessments.update_draft')
  discard(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.assessments.discard(tenant, id, requestMeta(req).ipAddress);
  }
}

/** A patient's assessment history, newest first. */
@Controller('patients')
export class PatientAssessmentsController {
  constructor(private readonly assessments: AssessmentsService) {}

  @Get(':id/assessments')
  @RequirePermissions('assessments.read_own')
  history(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.assessments.patientHistory(tenant, id);
  }
}
