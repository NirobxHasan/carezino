import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { isUniqueViolation } from '../centers/centers.service';
import { apiError } from '../common/errors';
import type { Prisma } from '../generated/prisma/client';
import {
  AssessmentTemplateStatus,
  TemplateVersionStatus,
} from '../generated/prisma/enums';
import { fieldError } from '../patients/contacts';
import { PrismaService } from '../prisma/prisma.service';
import { templateNotFound } from './access';
import {
  ASSESSMENT_LIMITS,
  type CreateTemplateDto,
  type ListTemplatesQuery,
  type UpdateTemplateDto,
} from './dto';
import {
  fieldCount,
  parseDefinition,
  typeChanges,
  type TemplateDefinition,
} from './engine';
import { STARTER_DEFINITION } from './starter';

type Tx = Prisma.TransactionClient;

const userSelect = { select: { id: true, fullName: true } } as const;

const templateSelect = {
  id: true,
  name: true,
  description: true,
  purpose: true,
  status: true,
  latestVersion: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  therapyType: {
    select: { id: true, name: true, code: true, color: true, isActive: true },
  },
  createdBy: userSelect,
  publishedVersionId: true,
  versions: {
    select: {
      id: true,
      version: true,
      status: true,
      definition: true,
      publishedAt: true,
      updatedAt: true,
      publishedBy: userSelect,
      _count: { select: { assessments: true } },
    },
    orderBy: { version: 'asc' },
  },
} satisfies Prisma.AssessmentTemplateSelect;

type TemplateRow = Prisma.AssessmentTemplateGetPayload<{
  select: typeof templateSelect;
}>;

/** Stored definitions were checked when saved; this only narrows the type. */
export function storedDefinition(value: Prisma.JsonValue): TemplateDefinition {
  return value as unknown as TemplateDefinition;
}

const archived = () =>
  apiError(
    HttpStatus.CONFLICT,
    'This template is archived. Restore it to make changes.',
    'TEMPLATE_ARCHIVED',
  );

const noDraft = () =>
  apiError(
    HttpStatus.CONFLICT,
    'This version is published, so its form can’t change. Start a new version to edit it.',
    'TEMPLATE_VERSION_PUBLISHED',
  );

function badDefinition(errors: Record<string, string>, message: string) {
  return apiError(HttpStatus.BAD_REQUEST, message, 'VALIDATION_FAILED', errors);
}

/**
 * Assessment templates. A template's form lives in versions: one draft at a time is
 * edited, publishing freezes it (the database refuses later changes) and makes it the
 * version new assessments use; earlier published versions stay for the assessments
 * that were filled in with them.
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private actions(tenant: TenantContext, row: TemplateRow) {
    const can = (p: TenantContext['permissions'][number]) =>
      tenant.permissions.includes(p);
    const active = row.status !== AssessmentTemplateStatus.ARCHIVED;
    const draft = row.versions.some(
      (v) => v.status === TemplateVersionStatus.DRAFT,
    );
    return {
      edit: active && can('assessment_templates.update'),
      startVersion:
        active &&
        !draft &&
        row.publishedVersionId !== null &&
        can('assessment_templates.update'),
      discardDraft: active && draft && can('assessment_templates.update'),
      publish: active && draft && can('assessment_templates.publish'),
      archive: active && can('assessment_templates.publish'),
      restore: !active && can('assessment_templates.publish'),
    };
  }

  private toItem(tenant: TenantContext, row: TemplateRow) {
    const draft = row.versions.find(
      (v) => v.status === TemplateVersionStatus.DRAFT,
    );
    const published = row.versions.find((v) => v.id === row.publishedVersionId);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      purpose: row.purpose,
      status: row.status,
      therapyType: row.therapyType,
      latestVersion: row.latestVersion,
      published: published
        ? {
            id: published.id,
            version: published.version,
            publishedAt: published.publishedAt,
            fieldCount: fieldCount(storedDefinition(published.definition)),
          }
        : null,
      draft: draft
        ? { id: draft.id, version: draft.version, updatedAt: draft.updatedAt }
        : null,
      assessmentCount: row.versions.reduce(
        (sum, v) => sum + v._count.assessments,
        0,
      ),
      createdBy: row.createdBy,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      actions: this.actions(tenant, row),
    };
  }

  private toDetail(tenant: TenantContext, row: TemplateRow) {
    const draft = row.versions.find(
      (v) => v.status === TemplateVersionStatus.DRAFT,
    );
    const published = row.versions.find((v) => v.id === row.publishedVersionId);
    const item = this.toItem(tenant, row);
    return {
      ...item,
      draft:
        draft && item.draft
          ? { ...item.draft, definition: storedDefinition(draft.definition) }
          : null,
      published:
        published && item.published
          ? {
              ...item.published,
              publishedBy: published.publishedBy,
              definition: storedDefinition(published.definition),
            }
          : null,
    };
  }

  private async find(
    db: Tx | PrismaService,
    tenant: TenantContext,
    id: string,
  ) {
    const row = await db.assessmentTemplate.findFirst({
      where: { id, centerId: tenant.centerId },
      select: templateSelect,
    });
    if (!row) throw templateNotFound();
    return row;
  }

  /** Locks the template row until the transaction ends, so version changes queue up. */
  private async lock(tx: Tx, tenant: TenantContext, id: string) {
    await tx.$queryRaw`
      SELECT id FROM "AssessmentTemplate"
      WHERE id = ${id}::uuid AND "centerId" = ${tenant.centerId}::uuid
      FOR UPDATE`;
    return this.find(tx, tenant, id);
  }

  private async therapyType(
    db: Tx | PrismaService,
    tenant: TenantContext,
    id: string,
  ) {
    const type = await db.therapyType.findFirst({
      where: { id, centerId: tenant.centerId },
      select: { id: true, name: true, isActive: true },
    });
    if (!type) {
      throw fieldError(
        'therapyTypeId',
        'This therapy no longer exists. Reload and try again.',
        'THERAPY_TYPE_NOT_FOUND',
      );
    }
    if (!type.isActive) {
      throw fieldError(
        'therapyTypeId',
        `${type.name} is inactive. Activate it in Settings first.`,
        'THERAPY_TYPE_INACTIVE',
      );
    }
    return type;
  }

  /** Names are unique per center, ignoring case. */
  private async assertNameFree(
    db: Tx,
    tenant: TenantContext,
    name: string,
    exceptId?: string,
  ) {
    const clash = await db.assessmentTemplate.findFirst({
      where: {
        centerId: tenant.centerId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId && { id: { not: exceptId } }),
      },
      select: { id: true },
    });
    if (clash) throw this.nameTaken();
  }

  private nameTaken() {
    return fieldError(
      'name',
      'Another template already has this name',
      'TEMPLATE_NAME_TAKEN',
    );
  }

  private draftDefinition(input: unknown) {
    const parsed = parseDefinition(input);
    if (parsed.errors) {
      throw badDefinition(parsed.errors, 'Please check the highlighted fields');
    }
    return parsed.definition;
  }

  /** Writes that may hit the unique name constraint, as a clean 400. */
  private async write<T>(fn: (tx: Tx) => Promise<T>) {
    try {
      return await this.prisma.$transaction(fn);
    } catch (error) {
      if (isUniqueViolation(error)) throw this.nameTaken();
      throw error;
    }
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  async list(tenant: TenantContext, query: ListTemplatesQuery) {
    const rows = await this.prisma.assessmentTemplate.findMany({
      where: {
        centerId: tenant.centerId,
        ...(query.therapyTypeId && { therapyTypeId: query.therapyTypeId }),
        ...(query.status?.length && { status: { in: query.status } }),
        ...(query.purpose && {
          OR: [{ purpose: query.purpose }, { purpose: null }],
        }),
        ...(query.search && {
          name: { contains: query.search, mode: 'insensitive' },
        }),
      },
      select: templateSelect,
      orderBy: [{ therapyType: { displayOrder: 'asc' } }, { name: 'asc' }],
    });
    return rows.map((r) => this.toItem(tenant, r));
  }

  async get(tenant: TenantContext, id: string) {
    return this.toDetail(tenant, await this.find(this.prisma, tenant, id));
  }

  async versions(tenant: TenantContext, id: string) {
    const row = await this.find(this.prisma, tenant, id);
    const versions = await this.prisma.assessmentTemplateVersion.findMany({
      where: { templateId: row.id },
      select: {
        id: true,
        version: true,
        status: true,
        definition: true,
        publishedAt: true,
        publishedBy: userSelect,
        createdBy: userSelect,
        createdAt: true,
        _count: { select: { assessments: true } },
      },
      orderBy: { version: 'desc' },
    });
    return versions.map(({ definition, _count, ...v }) => ({
      ...v,
      fieldCount: fieldCount(storedDefinition(definition)),
      assessmentCount: _count.assessments,
    }));
  }

  /** One version's form, e.g. to show how an older version looked. */
  async version(tenant: TenantContext, id: string, versionId: string) {
    const version = await this.prisma.assessmentTemplateVersion.findFirst({
      where: { id: versionId, templateId: id, centerId: tenant.centerId },
      select: {
        id: true,
        version: true,
        status: true,
        definition: true,
        publishedAt: true,
        publishedBy: userSelect,
        createdAt: true,
        template: { select: { id: true, name: true } },
      },
    });
    if (!version) throw templateNotFound();
    return { ...version, definition: storedDefinition(version.definition) };
  }

  // ── Writing ───────────────────────────────────────────────────────────────

  async create(
    tenant: TenantContext,
    dto: CreateTemplateDto,
    ip: string | null,
  ) {
    const definition =
      dto.definition !== undefined
        ? this.draftDefinition(dto.definition)
        : dto.starter
          ? STARTER_DEFINITION
          : { sections: [] };
    const id = await this.write(async (tx) => {
      await this.therapyType(tx, tenant, dto.therapyTypeId);
      await this.assertNameFree(tx, tenant, dto.name);
      const count = await tx.assessmentTemplate.count({
        where: { centerId: tenant.centerId },
      });
      if (count >= ASSESSMENT_LIMITS.templatesPerCenter) {
        throw apiError(
          HttpStatus.CONFLICT,
          `A center can have up to ${ASSESSMENT_LIMITS.templatesPerCenter} templates. Archive or remove unused ones first.`,
          'TEMPLATE_LIMIT',
        );
      }
      const template = await tx.assessmentTemplate.create({
        data: {
          centerId: tenant.centerId,
          therapyTypeId: dto.therapyTypeId,
          name: dto.name,
          description: dto.description ?? null,
          purpose: dto.purpose ?? null,
          createdById: tenant.userId,
          versions: {
            create: {
              centerId: tenant.centerId,
              version: 1,
              definition: definition as unknown as Prisma.InputJsonValue,
              createdById: tenant.userId,
            },
          },
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'assessment_template.created',
          entityType: 'AssessmentTemplate',
          entityId: template.id,
          metadata: { name: dto.name, starter: Boolean(dto.starter) },
          ipAddress: ip,
        },
        tx,
      );
      return template.id;
    });
    return this.get(tenant, id);
  }

  /** Details at any time; the therapy only before first publish; the form only as a draft. */
  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateTemplateDto,
    ip: string | null,
  ) {
    const definition =
      dto.definition !== undefined
        ? this.draftDefinition(dto.definition)
        : undefined;
    await this.write(async (tx) => {
      const row = await this.lock(tx, tenant, id);
      if (row.status === AssessmentTemplateStatus.ARCHIVED) throw archived();
      if (dto.name !== undefined) {
        await this.assertNameFree(tx, tenant, dto.name, id);
      }
      if (
        dto.therapyTypeId !== undefined &&
        dto.therapyTypeId !== row.therapyType.id
      ) {
        if (row.publishedVersionId) {
          throw fieldError(
            'therapyTypeId',
            'The therapy can’t change once a version is published. Create a new template instead.',
            'TEMPLATE_PUBLISHED',
          );
        }
        await this.therapyType(tx, tenant, dto.therapyTypeId);
      }
      if (definition) {
        const draft = row.versions.find(
          (v) => v.status === TemplateVersionStatus.DRAFT,
        );
        if (!draft) throw noDraft();
        await tx.assessmentTemplateVersion.update({
          where: { id: draft.id },
          data: { definition: definition as unknown as Prisma.InputJsonValue },
        });
      }
      const changed = (
        ['name', 'description', 'purpose', 'therapyTypeId'] as const
      ).filter((k) => dto[k] !== undefined);
      await tx.assessmentTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
          ...(dto.purpose !== undefined && { purpose: dto.purpose }),
          ...(dto.therapyTypeId !== undefined && {
            therapyTypeId: dto.therapyTypeId,
          }),
          // Touch the template so lists show the form changed too.
          updatedAt: new Date(),
        },
      });
      if (changed.length) {
        await this.audit.record(
          {
            centerId: tenant.centerId,
            actorUserId: tenant.userId,
            action: 'assessment_template.updated',
            entityType: 'AssessmentTemplate',
            entityId: id,
            metadata: { fields: changed },
            ipAddress: ip,
          },
          tx,
        );
      }
    });
    return this.get(tenant, id);
  }

  /** A new draft version, copied from the published one. */
  async startVersion(tenant: TenantContext, id: string, ip: string | null) {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, tenant, id);
      if (row.status === AssessmentTemplateStatus.ARCHIVED) throw archived();
      if (row.versions.some((v) => v.status === TemplateVersionStatus.DRAFT)) {
        throw apiError(
          HttpStatus.CONFLICT,
          'A new version is already being edited.',
          'TEMPLATE_DRAFT_EXISTS',
        );
      }
      const published = row.versions.find(
        (v) => v.id === row.publishedVersionId,
      );
      if (!published) throw noDraft();
      const version = row.latestVersion + 1;
      await tx.assessmentTemplateVersion.create({
        data: {
          centerId: tenant.centerId,
          templateId: id,
          version,
          definition: published.definition as Prisma.InputJsonValue,
          createdById: tenant.userId,
        },
      });
      await tx.assessmentTemplate.update({
        where: { id },
        data: { latestVersion: version },
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'assessment_template.version_started',
          entityType: 'AssessmentTemplate',
          entityId: id,
          metadata: { version },
          ipAddress: ip,
        },
        tx,
      );
    });
    return this.get(tenant, id);
  }

  /**
   * Throws the draft version away. A template that was never published goes with it;
   * no assessment can use a draft, so nothing refers to either.
   */
  async discardDraft(tenant: TenantContext, id: string, ip: string | null) {
    const removed = await this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, tenant, id);
      if (row.status === AssessmentTemplateStatus.ARCHIVED) throw archived();
      const draft = row.versions.find(
        (v) => v.status === TemplateVersionStatus.DRAFT,
      );
      if (!draft) {
        throw apiError(
          HttpStatus.CONFLICT,
          'There’s no draft to discard.',
          'TEMPLATE_NO_DRAFT',
        );
      }
      await tx.assessmentTemplateVersion.delete({ where: { id: draft.id } });
      const remaining = row.versions.filter((v) => v.id !== draft.id);
      const removeTemplate = remaining.length === 0;
      if (removeTemplate) {
        await tx.assessmentTemplate.delete({ where: { id } });
      } else {
        await tx.assessmentTemplate.update({
          where: { id },
          data: {
            latestVersion: Math.max(...remaining.map((v) => v.version)),
          },
        });
      }
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: removeTemplate
            ? 'assessment_template.deleted'
            : 'assessment_template.draft_discarded',
          entityType: 'AssessmentTemplate',
          entityId: id,
          metadata: { name: row.name, version: draft.version },
          ipAddress: ip,
        },
        tx,
      );
      return removeTemplate;
    });
    return removed ? { deleted: true as const } : this.get(tenant, id);
  }

  /**
   * Freezes the draft and makes it the version new assessments use. The form must be
   * complete, and fields kept from earlier versions must keep their types.
   */
  async publish(tenant: TenantContext, id: string, ip: string | null) {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, tenant, id);
      if (row.status === AssessmentTemplateStatus.ARCHIVED) throw archived();
      const draft = row.versions.find(
        (v) => v.status === TemplateVersionStatus.DRAFT,
      );
      if (!draft) {
        throw apiError(
          HttpStatus.CONFLICT,
          'This version is already published.',
          'TEMPLATE_NO_DRAFT',
        );
      }
      const parsed = parseDefinition(draft.definition, { forPublish: true });
      if (parsed.errors) {
        throw badDefinition(
          parsed.errors,
          'Finish the form before publishing: every section needs at least one field.',
        );
      }
      const earlier = row.versions
        .filter((v) => v.status !== TemplateVersionStatus.DRAFT)
        .map((v) => storedDefinition(v.definition));
      const changes = typeChanges(parsed.definition, earlier);
      if (Object.keys(changes).length) {
        throw badDefinition(changes, Object.values(changes)[0]);
      }
      const now = new Date();
      // The old version first: only one version may be published at a time.
      if (row.publishedVersionId) {
        await tx.assessmentTemplateVersion.update({
          where: { id: row.publishedVersionId },
          data: { status: TemplateVersionStatus.SUPERSEDED },
        });
      }
      await tx.assessmentTemplateVersion.update({
        where: { id: draft.id },
        data: {
          status: TemplateVersionStatus.PUBLISHED,
          // Stored normalized, exactly as validated.
          definition: parsed.definition as unknown as Prisma.InputJsonValue,
          publishedAt: now,
          publishedById: tenant.userId,
        },
      });
      await tx.assessmentTemplate.update({
        where: { id },
        data: {
          status: AssessmentTemplateStatus.PUBLISHED,
          publishedVersionId: draft.id,
        },
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'assessment_template.published',
          entityType: 'AssessmentTemplate',
          entityId: id,
          metadata: { name: row.name, version: draft.version },
          ipAddress: ip,
        },
        tx,
      );
    });
    return this.get(tenant, id);
  }

  /** No new assessments from it; existing ones keep their form. */
  async archive(tenant: TenantContext, id: string, ip: string | null) {
    return this.setArchived(tenant, id, true, ip);
  }

  async restore(tenant: TenantContext, id: string, ip: string | null) {
    return this.setArchived(tenant, id, false, ip);
  }

  private async setArchived(
    tenant: TenantContext,
    id: string,
    archive: boolean,
    ip: string | null,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, tenant, id);
      const isArchived = row.status === AssessmentTemplateStatus.ARCHIVED;
      if (isArchived === archive) return;
      await tx.assessmentTemplate.update({
        where: { id },
        data: archive
          ? {
              status: AssessmentTemplateStatus.ARCHIVED,
              archivedAt: new Date(),
            }
          : {
              status: row.publishedVersionId
                ? AssessmentTemplateStatus.PUBLISHED
                : AssessmentTemplateStatus.DRAFT,
              archivedAt: null,
            },
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: archive
            ? 'assessment_template.archived'
            : 'assessment_template.restored',
          entityType: 'AssessmentTemplate',
          entityId: id,
          metadata: { name: row.name },
          ipAddress: ip,
        },
        tx,
      );
    });
    return this.get(tenant, id);
  }
}
