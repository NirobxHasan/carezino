import { Injectable } from '@nestjs/common';

import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  centerId: string | null;
  actorUserId: string | null;
  /** Dotted action name, e.g. staff.role_changed */
  action: string;
  entityType: string;
  entityId?: string | null;
  /** Non-sensitive context only: never passwords, tokens or hashes. */
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}

/** Records sensitive administrative actions. Pass `tx` to commit with the change itself. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: Prisma.TransactionClient) {
    await (tx ?? this.prisma).auditLog.create({
      data: {
        centerId: entry.centerId,
        actorUserId: entry.actorUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  }
}
