import { Global, Module } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { AppConfig } from '../config/app-config';
import { MailService } from '../mail/mail.service';

/** Cross-cutting services every feature module can inject. */
@Global()
@Module({
  providers: [AppConfig, AuditService, MailService],
  exports: [AppConfig, AuditService, MailService],
})
export class CommonModule {}
