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
  CreateNoteTemplateDto,
  ListNoteTemplatesQuery,
  UpdateNoteTemplateDto,
} from './dto';
import { NoteTemplatesService } from './templates.service';

/**
 * Session note templates of the active center. Therapists read them to choose one for
 * a note; administrators manage them (Settings).
 */
@Controller('session-note-templates')
export class NoteTemplatesController {
  constructor(private readonly templates: NoteTemplatesService) {}

  @Get()
  @RequirePermissions('session_note_templates.read')
  list(
    @Tenant() tenant: TenantContext,
    @Query() query: ListNoteTemplatesQuery,
  ) {
    return this.templates.list(tenant, query);
  }

  @Post()
  @RequirePermissions('session_note_templates.manage')
  create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateNoteTemplateDto,
    @Req() req: Request,
  ) {
    return this.templates.create(tenant, dto, requestMeta(req).ipAddress);
  }

  @Get(':id')
  @RequirePermissions('session_note_templates.read')
  get(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get(tenant, id);
  }

  /** Details, the draft form, and whether it's the default for its therapy. */
  @Patch(':id')
  @RequirePermissions('session_note_templates.manage')
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoteTemplateDto,
    @Req() req: Request,
  ) {
    return this.templates.update(tenant, id, dto, requestMeta(req).ipAddress);
  }

  @Get(':id/versions')
  @RequirePermissions('session_note_templates.read')
  versions(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templates.versions(tenant, id);
  }

  /** Starts a new draft version from the published one. */
  @Post(':id/versions')
  @RequirePermissions('session_note_templates.manage')
  startVersion(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.templates.startVersion(tenant, id, requestMeta(req).ipAddress);
  }

  @Get(':id/versions/:versionId')
  @RequirePermissions('session_note_templates.read')
  version(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    return this.templates.version(tenant, id, versionId);
  }

  /** Discards the draft version; a never-published template is deleted with it. */
  @Delete(':id/draft')
  @RequirePermissions('session_note_templates.manage')
  discardDraft(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.templates.discardDraft(tenant, id, requestMeta(req).ipAddress);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermissions('session_note_templates.manage')
  publish(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.templates.publish(tenant, id, requestMeta(req).ipAddress);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('session_note_templates.manage')
  archive(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.templates.archive(tenant, id, requestMeta(req).ipAddress);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('session_note_templates.manage')
  restore(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.templates.restore(tenant, id, requestMeta(req).ipAddress);
  }
}
