import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { requestMeta, type AuthContext } from '../auth/auth-context';
import { CurrentAuth, PlatformAdminOnly } from '../auth/decorators';
import { RegisterCenterDto } from '../auth/dto';
import { ListCentersQuery } from './dto';
import { PlatformService } from './platform.service';

/** Super admin: every center on the platform. */
@Controller('platform/centers')
@PlatformAdminOnly()
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get()
  list(@Query() query: ListCentersQuery) {
    return this.platform.listCenters(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.getCenter(id);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: RegisterCenterDto,
    @Req() req: Request,
  ) {
    return this.platform.createCenter(auth, dto, requestMeta(req).ipAddress);
  }
}
