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
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { requestMeta, type TenantContext } from '../auth/auth-context';
import { RequirePermissions, Tenant } from '../auth/decorators';
import {
  AmendNoteDto,
  CheckInDto,
  CompleteNoteDto,
  CompleteSessionDto,
  CorrectSessionDto,
  CreateNoteDto,
  ListSessionsQuery,
  PatientSessionsQuery,
  RecordAttendanceDto,
  TodaySessionsQuery,
  UpdateNoteDto,
} from './dto';
import { SessionLifecycle } from './lifecycle.service';
import { SessionNotesService } from './notes.service';
import { SessionsService } from './sessions.service';

/**
 * Sessions of the active center, addressed by their appointment's ID. Reads need
 * sessions.read_own at least; the service shows every session (sessions.read) or only
 * the caller's own. Note routes add the session_notes permissions, and note content
 * is limited further by access.ts. Static routes come before :id.
 */
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly lifecycle: SessionLifecycle,
    private readonly notes: SessionNotesService,
  ) {}

  /** One day's sessions with the day's counts; today unless ?date= is given. */
  @Get('today')
  @RequirePermissions('sessions.read_own')
  today(@Tenant() tenant: TenantContext, @Query() query: TodaySessionsQuery) {
    return this.sessions.today(tenant, query);
  }

  @Get()
  @RequirePermissions('sessions.read_own')
  list(@Tenant() tenant: TenantContext, @Query() query: ListSessionsQuery) {
    return this.sessions.list(tenant, query);
  }

  @Get(':id')
  @RequirePermissions('sessions.read_own')
  get(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.get(tenant, id);
  }

  /** Recording attendance along with it also needs attendance.record (service). */
  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermissions('sessions.read_own', 'sessions.complete')
  async complete(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteSessionDto,
  ) {
    await this.lifecycle.complete(tenant, id, dto);
    return this.sessions.get(tenant, id);
  }

  @Post(':id/correct')
  @HttpCode(200)
  @RequirePermissions('sessions.read', 'sessions.correct')
  async correct(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectSessionDto,
    @Req() req: Request,
  ) {
    await this.lifecycle.correct(tenant, id, dto, requestMeta(req).ipAddress);
    return this.sessions.get(tenant, id);
  }

  @Get(':id/note')
  @RequirePermissions('session_notes.read_own')
  note(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notes.get(tenant, id);
  }

  /** Opens the session's note (a draft), or returns the one that exists. */
  @Post(':id/note')
  @HttpCode(200)
  @RequirePermissions('sessions.read_own', 'session_notes.create')
  createNote(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateNoteDto,
    @Req() req: Request,
  ) {
    return this.notes.create(tenant, id, dto, requestMeta(req).ipAddress);
  }

  @Patch(':id/note')
  @RequirePermissions('session_notes.read_own', 'session_notes.update_draft')
  updateNote(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoteDto,
  ) {
    return this.notes.update(tenant, id, dto);
  }

  @Post(':id/note/complete')
  @HttpCode(200)
  @RequirePermissions('session_notes.read_own', 'session_notes.complete')
  completeNote(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteNoteDto,
    @Req() req: Request,
  ) {
    return this.notes.complete(tenant, id, dto, requestMeta(req).ipAddress);
  }

  @Post(':id/note/amend')
  @HttpCode(200)
  @RequirePermissions('session_notes.read_own', 'session_notes.amend')
  amendNote(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AmendNoteDto,
    @Req() req: Request,
  ) {
    return this.notes.amend(tenant, id, dto, requestMeta(req).ipAddress);
  }

  /** Discards a draft note; completed notes are kept. */
  @Delete(':id/note')
  @HttpCode(204)
  @RequirePermissions('session_notes.read_own', 'session_notes.update_draft')
  async discardNote(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.notes.discard(tenant, id, requestMeta(req).ipAddress);
  }

  /** The note before amendment `number`; number 1 holds the signed original. */
  @Get(':id/note/amendments/:number')
  @RequirePermissions('session_notes.read_own')
  noteAmendment(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('number', ParseIntPipe) number: number,
  ) {
    return this.notes.amendment(tenant, id, number);
  }
}

/** Attendance and the session of one appointment. */
@Controller('appointments')
export class AppointmentAttendanceController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly lifecycle: SessionLifecycle,
  ) {}

  /** Records arrival now (present, or late with { late: true }); today only. */
  @Post(':id/check-in')
  @HttpCode(200)
  @RequirePermissions('attendance.read', 'attendance.record')
  async checkIn(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CheckInDto,
    @Req() req: Request,
  ) {
    await this.lifecycle.checkIn(tenant, id, dto, requestMeta(req).ipAddress);
    return this.sessions.get(tenant, id);
  }

  @Get(':id/attendance')
  @RequirePermissions('attendance.read')
  attendance(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sessions.attendance(tenant, id);
  }

  /** Corrections after the appointment closed also need attendance.correct (service). */
  @Put(':id/attendance')
  @RequirePermissions('attendance.read', 'attendance.record')
  async recordAttendance(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordAttendanceDto,
    @Req() req: Request,
  ) {
    await this.lifecycle.recordAttendance(
      tenant,
      id,
      dto,
      requestMeta(req).ipAddress,
    );
    return this.sessions.get(tenant, id);
  }

  /** Starts the session explicitly; opening its note starts it too. */
  @Post(':id/session')
  @HttpCode(200)
  @RequirePermissions('sessions.read_own', 'sessions.complete')
  async start(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.lifecycle.start(tenant, id);
    return this.sessions.get(tenant, id);
  }
}

@Controller('my-sessions')
export class MySessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  @RequirePermissions('sessions.read_own')
  mine(@Tenant() tenant: TenantContext) {
    return this.sessions.mine(tenant);
  }
}

@Controller('patients')
export class PatientSessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get(':id/sessions')
  @RequirePermissions('sessions.read_own')
  list(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PatientSessionsQuery,
  ) {
    return this.sessions.patientSessions(tenant, id, query);
  }
}
