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
import {
  CreateTemplateDto,
  ListTemplatesQuery,
  UpdateTemplateDto,
} from './dto';
import { TemplatesService } from './templates.service';

/** The center's assessment templates and their versioned forms. */
@Controller('assessment-templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @RequirePermissions('assessment_templates.read')
  list(@Tenant() tenant: TenantContext, @Query() query: ListTemplatesQuery) {
    return this.templates.list(tenant, query);
  }

  /** A draft, empty or from the starter form (`starter: true`). */
  @Post()
  @RequirePermissions('assessment_templates.create')
  create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateTemplateDto,
    @Req() req: Request,
  ) {
    return this.templates.create(tenant, dto, requestMeta(req).ipAddress);
  }

  @Get(':id')
  @RequirePermissions('assessment_templates.read')
  get(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get(tenant, id);
  }

  /** Details, and the form of the draft version (published versions are frozen). */
  @Patch(':id')
  @RequirePermissions('assessment_templates.update')
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
    @Req() req: Request,
  ) {
    return this.templates.update(tenant, id, dto, requestMeta(req).ipAddress);
  }

  @Get(':id/versions')
  @RequirePermissions('assessment_templates.read')
  versions(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templates.versions(tenant, id);
  }

  /** Starts a new draft version from the published one. */
  @Post(':id/versions')
  @RequirePermissions('assessment_templates.update')
  startVersion(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.templates.startVersion(tenant, id, requestMeta(req).ipAddress);
  }

  @Get(':id/versions/:versionId')
  @RequirePermissions('assessment_templates.read')
  version(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    return this.templates.version(tenant, id, versionId);
  }

  /** Discards the draft version; a never-published template is deleted with it. */
  @Delete(':id/draft')
  @RequirePermissions('assessment_templates.update')
  discardDraft(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.templates.discardDraft(tenant, id, requestMeta(req).ipAddress);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermissions('assessment_templates.publish')
  publish(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.templates.publish(tenant, id, requestMeta(req).ipAddress);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('assessment_templates.publish')
  archive(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.templates.archive(tenant, id, requestMeta(req).ipAddress);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('assessment_templates.publish')
  restore(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.templates.restore(tenant, id, requestMeta(req).ipAddress);
  }
}
