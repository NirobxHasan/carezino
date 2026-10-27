import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { isUniqueViolation } from '../centers/centers.service';
import { apiError } from '../common/errors';
import { lockCenter } from '../common/locks';
import {
  fieldCount,
  parseDefinition,
  storedDefinition,
  typeChanges,
  type TemplateDefinition,
} from '../forms/engine';
import type { Prisma } from '../generated/prisma/client';
import {
  SessionNoteTemplateStatus,
  TemplateVersionStatus,
} from '../generated/prisma/enums';
import { fieldError } from '../patients/contacts';
import { PrismaService } from '../prisma/prisma.service';
import { noteTemplateNotFound } from './access';
import {
  SESSION_LIMITS,
  type CreateNoteTemplateDto,
  type ListNoteTemplatesQuery,
  type UpdateNoteTemplateDto,
} from './dto';
import { STARTER_NOTE_DEFINITION, STARTER_NOTE_NAME } from './starter';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;

const userSelect = { select: { id: true, fullName: true } } as const;

const templateSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  isDefault: true,
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
      _count: { select: { notes: true } },
    },
    orderBy: { version: 'asc' },
  },
} satisfies Prisma.SessionNoteTemplateSelect;

type TemplateRow = Prisma.SessionNoteTemplateGetPayload<{
  select: typeof templateSelect;
}>;

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

/** The form a new note uses: a published version of a template it may use. */
export interface NoteForm {
  versionId: string;
  definition: TemplateDefinition;
}

/**
 * Session note templates: the same versioning as assessment templates (one draft edited
 * at a time, published versions frozen by the database, notes keep the exact version
 * they were written with) on their own tables, since notes and assessments are separate
 * records. A template is either for one therapy type or general (any type), and one
 * published template per therapy type, and one general one, can be the default.
 */
@Injectable()
export class NoteTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private actions(tenant: TenantContext, row: TemplateRow) {
    const manage = tenant.permissions.includes('session_note_templates.manage');
    const active = row.status !== SessionNoteTemplateStatus.ARCHIVED;
    const draft = row.versions.some(
      (v) => v.status === TemplateVersionStatus.DRAFT,
    );
    return {
      edit: active && manage,
      startVersion:
        active && !draft && row.publishedVersionId !== null && manage,
      discardDraft: active && draft && manage,
      publish: active && draft && manage,
      archive: active && manage,
      restore: !active && manage,
      makeDefault:
        row.status === SessionNoteTemplateStatus.PUBLISHED &&
        !row.isDefault &&
        manage,
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
      status: row.status,
      isDefault: row.isDefault,
      /** Null: a general template, for every therapy type */
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
      noteCount: row.versions.reduce((sum, v) => sum + v._count.notes, 0),
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

  private async find(db: Db, tenant: TenantContext, id: string) {
    const row = await db.sessionNoteTemplate.findFirst({
      where: { id, centerId: tenant.centerId },
      select: templateSelect,
    });
    if (!row) throw noteTemplateNotFound();
    return row;
  }

  /** Locks the template row until the transaction ends, so version changes queue up. */
  private async lock(tx: Tx, tenant: TenantContext, id: string) {
    await tx.$queryRaw`
      SELECT id FROM "SessionNoteTemplate"
      WHERE id = ${id}::uuid AND "centerId" = ${tenant.centerId}::uuid
      FOR UPDATE`;
    return this.find(tx, tenant, id);
  }

  private async therapyType(db: Db, tenant: TenantContext, id: string) {
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
    const clash = await db.sessionNoteTemplate.findFirst({
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

  private record(
    tx: Tx,
    tenant: TenantContext,
    action: string,
    id: string,
    metadata: Prisma.InputJsonValue,
    ip: string | null,
  ) {
    return this.audit.record(
      {
        centerId: tenant.centerId,
        actorUserId: tenant.userId,
        action: `session_note_template.${action}`,
        entityType: 'SessionNoteTemplate',
        entityId: id,
        metadata,
        ipAddress: ip,
      },
      tx,
    );
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  async list(tenant: TenantContext, query: ListNoteTemplatesQuery) {
    const rows = await this.prisma.sessionNoteTemplate.findMany({
      where: {
        centerId: tenant.centerId,
        ...(query.therapyTypeId && { therapyTypeId: query.therapyTypeId }),
        ...(query.usableFor && {
          status: SessionNoteTemplateStatus.PUBLISHED,
          OR: [{ therapyTypeId: query.usableFor }, { therapyTypeId: null }],
        }),
        ...(query.status?.length &&
          !query.usableFor && { status: { in: query.status } }),
        ...(query.search && {
          name: { contains: query.search, mode: 'insensitive' },
        }),
      },
      select: templateSelect,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    // General templates first, then by therapy; defaults first within each.
    const therapy = (r: TemplateRow) => r.therapyType?.name ?? '';
    return rows
      .sort((a, b) => therapy(a).localeCompare(therapy(b)))
      .map((r) => this.toItem(tenant, r));
  }

  async get(tenant: TenantContext, id: string) {
    return this.toDetail(tenant, await this.find(this.prisma, tenant, id));
  }

  async versions(tenant: TenantContext, id: string) {
    const row = await this.find(this.prisma, tenant, id);
    const versions = await this.prisma.sessionNoteTemplateVersion.findMany({
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
        _count: { select: { notes: true } },
      },
      orderBy: { version: 'desc' },
    });
    return versions.map(({ definition, _count, ...v }) => ({
      ...v,
      fieldCount: fieldCount(storedDefinition(definition)),
      noteCount: _count.notes,
    }));
  }

  async version(tenant: TenantContext, id: string, versionId: string) {
    const version = await this.prisma.sessionNoteTemplateVersion.findFirst({
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
    if (!version) throw noteTemplateNotFound();
    return { ...version, definition: storedDefinition(version.definition) };
  }

  /**
   * The form for a new note of a therapy type. A chosen template must be published and
   * for that therapy or general. Otherwise, in order: the therapy's default, the general
   * default, the therapy's only or first published template, the first general one. A
   * center with no note templates at all gets the standard one (published, default), so
   * documentation works from day one; it can be edited or replaced in Settings.
   */
  async formForNote(
    tenant: TenantContext,
    therapyTypeId: string,
    templateId: string | undefined,
    ip: string | null,
  ): Promise<NoteForm> {
    const usable = {
      centerId: tenant.centerId,
      status: SessionNoteTemplateStatus.PUBLISHED,
      OR: [{ therapyTypeId }, { therapyTypeId: null }],
    } satisfies Prisma.SessionNoteTemplateWhereInput;
    const select = {
      therapyTypeId: true,
      isDefault: true,
      publishedVersion: { select: { id: true, definition: true } },
    } satisfies Prisma.SessionNoteTemplateSelect;
    if (templateId) {
      const chosen = await this.prisma.sessionNoteTemplate.findFirst({
        where: { id: templateId, ...usable },
        select,
      });
      if (!chosen?.publishedVersion) {
        throw fieldError(
          'templateId',
          'This template can’t be used for this session. Choose another.',
          'TEMPLATE_NOT_USABLE',
        );
      }
      return {
        versionId: chosen.publishedVersion.id,
        definition: storedDefinition(chosen.publishedVersion.definition),
      };
    }
    const candidates = await this.prisma.sessionNoteTemplate.findMany({
      where: usable,
      select,
      orderBy: { name: 'asc' },
    });
    const pick =
      candidates.find((t) => t.therapyTypeId && t.isDefault) ??
      candidates.find((t) => !t.therapyTypeId && t.isDefault) ??
      candidates.find((t) => t.therapyTypeId) ??
      candidates[0];
    if (pick?.publishedVersion) {
      return {
        versionId: pick.publishedVersion.id,
        definition: storedDefinition(pick.publishedVersion.definition),
      };
    }
    const starter = await this.provisionStarter(tenant, ip);
    if (!starter) {
      throw apiError(
        HttpStatus.CONFLICT,
        'There’s no published session note template for this therapy. Ask an administrator to publish one in Settings.',
        'NO_NOTE_TEMPLATE',
      );
    }
    return starter;
  }

  /**
   * Creates the standard template, published and default, if the center has none at
   * all. Returns its form, or null when the center already has templates (none usable).
   */
  private async provisionStarter(
    tenant: TenantContext,
    ip: string | null,
  ): Promise<NoteForm | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockCenter(tx, tenant.centerId);
        const count = await tx.sessionNoteTemplate.count({
          where: { centerId: tenant.centerId },
        });
        if (count > 0) return null;
        const now = new Date();
        const template = await tx.sessionNoteTemplate.create({
          data: {
            centerId: tenant.centerId,
            name: STARTER_NOTE_NAME,
            description:
              'Created automatically for the first session note. Edit it, or add templates per therapy, in Settings.',
            createdById: tenant.userId,
          },
          select: { id: true },
        });
        const version = await tx.sessionNoteTemplateVersion.create({
          data: {
            centerId: tenant.centerId,
            templateId: template.id,
            version: 1,
            status: TemplateVersionStatus.PUBLISHED,
            definition:
              STARTER_NOTE_DEFINITION as unknown as Prisma.InputJsonValue,
            createdById: tenant.userId,
            publishedById: tenant.userId,
            publishedAt: now,
          },
          select: { id: true },
        });
        await tx.sessionNoteTemplate.update({
          where: { id: template.id },
          data: {
            status: SessionNoteTemplateStatus.PUBLISHED,
            publishedVersionId: version.id,
            isDefault: true,
          },
        });
        await this.record(
          tx,
          tenant,
          'created',
          template.id,
          { name: STARTER_NOTE_NAME, starter: true, automatic: true },
          ip,
        );
        return { versionId: version.id, definition: STARTER_NOTE_DEFINITION };
      });
    } catch (error) {
      // Someone else created the first template meanwhile; use whatever exists now.
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  // ── Writing ───────────────────────────────────────────────────────────────

  async create(
    tenant: TenantContext,
    dto: CreateNoteTemplateDto,
    ip: string | null,
  ) {
    const definition =
      dto.definition !== undefined
        ? this.draftDefinition(dto.definition)
        : dto.starter
          ? STARTER_NOTE_DEFINITION
          : { sections: [] };
    const id = await this.write(async (tx) => {
      if (dto.therapyTypeId) {
        await this.therapyType(tx, tenant, dto.therapyTypeId);
      }
      await this.assertNameFree(tx, tenant, dto.name);
      const count = await tx.sessionNoteTemplate.count({
        where: { centerId: tenant.centerId },
      });
      if (count >= SESSION_LIMITS.templatesPerCenter) {
        throw apiError(
          HttpStatus.CONFLICT,
          `A center can have up to ${SESSION_LIMITS.templatesPerCenter} note templates. Archive unused ones first.`,
          'TEMPLATE_LIMIT',
        );
      }
      const template = await tx.sessionNoteTemplate.create({
        data: {
          centerId: tenant.centerId,
          therapyTypeId: dto.therapyTypeId ?? null,
          name: dto.name,
          description: dto.description ?? null,
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
      await this.record(
        tx,
        tenant,
        'created',
        template.id,
        { name: dto.name, starter: Boolean(dto.starter) },
        ip,
      );
      return template.id;
    });
    return this.get(tenant, id);
  }

  /**
   * Details at any time; the therapy only before first publish; the form only as a
   * draft; the default only for a published template (the previous default of the
   * same therapy, or of general templates, stops being one).
   */
  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateNoteTemplateDto,
    ip: string | null,
  ) {
    const definition =
      dto.definition !== undefined
        ? this.draftDefinition(dto.definition)
        : undefined;
    await this.write(async (tx) => {
      if (dto.isDefault !== undefined) await lockCenter(tx, tenant.centerId);
      const row = await this.lock(tx, tenant, id);
      if (row.status === SessionNoteTemplateStatus.ARCHIVED) throw archived();
      if (dto.name !== undefined) {
        await this.assertNameFree(tx, tenant, dto.name, id);
      }
      const typeChanged =
        dto.therapyTypeId !== undefined &&
        dto.therapyTypeId !== (row.therapyType?.id ?? null);
      if (typeChanged) {
        if (row.publishedVersionId) {
          throw fieldError(
            'therapyTypeId',
            'The therapy can’t change once a version is published. Create a new template instead.',
            'TEMPLATE_PUBLISHED',
          );
        }
        if (dto.therapyTypeId) {
          await this.therapyType(tx, tenant, dto.therapyTypeId);
        }
      }
      if (definition) {
        const draft = row.versions.find(
          (v) => v.status === TemplateVersionStatus.DRAFT,
        );
        if (!draft) throw noDraft();
        await tx.sessionNoteTemplateVersion.update({
          where: { id: draft.id },
          data: { definition: definition as unknown as Prisma.InputJsonValue },
        });
      }
      if (dto.isDefault === true && !row.isDefault) {
        if (row.status !== SessionNoteTemplateStatus.PUBLISHED) {
          throw fieldError(
            'isDefault',
            'Publish the template before making it the default.',
            'TEMPLATE_NOT_PUBLISHED',
          );
        }
        await tx.sessionNoteTemplate.updateMany({
          where: {
            centerId: tenant.centerId,
            therapyTypeId: row.therapyType?.id ?? null,
            isDefault: true,
          },
          data: { isDefault: false },
        });
      }
      const changed = (
        ['name', 'description', 'therapyTypeId', 'isDefault'] as const
      ).filter((k) => dto[k] !== undefined);
      await tx.sessionNoteTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
          ...(typeChanged && { therapyTypeId: dto.therapyTypeId }),
          ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
          // Touch the template so lists show the form changed too.
          updatedAt: new Date(),
        },
      });
      if (changed.length) {
        await this.record(tx, tenant, 'updated', id, { fields: changed }, ip);
      }
    });
    return this.get(tenant, id);
  }

  /** A new draft version, copied from the published one. */
  async startVersion(tenant: TenantContext, id: string, ip: string | null) {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, tenant, id);
      if (row.status === SessionNoteTemplateStatus.ARCHIVED) throw archived();
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
      await tx.sessionNoteTemplateVersion.create({
        data: {
          centerId: tenant.centerId,
          templateId: id,
          version,
          definition: published.definition as Prisma.InputJsonValue,
          createdById: tenant.userId,
        },
      });
      await tx.sessionNoteTemplate.update({
        where: { id },
        data: { latestVersion: version },
      });
      await this.record(tx, tenant, 'version_started', id, { version }, ip);
    });
    return this.get(tenant, id);
  }

  /**
   * Throws the draft version away. A template that was never published goes with it;
   * no note can use a draft, so nothing refers to either.
   */
  async discardDraft(tenant: TenantContext, id: string, ip: string | null) {
    const removed = await this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, tenant, id);
      if (row.status === SessionNoteTemplateStatus.ARCHIVED) throw archived();
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
      await tx.sessionNoteTemplateVersion.delete({ where: { id: draft.id } });
      const remaining = row.versions.filter((v) => v.id !== draft.id);
      const removeTemplate = remaining.length === 0;
      if (removeTemplate) {
        await tx.sessionNoteTemplate.delete({ where: { id } });
      } else {
        await tx.sessionNoteTemplate.update({
          where: { id },
          data: {
            latestVersion: Math.max(...remaining.map((v) => v.version)),
          },
        });
      }
      await this.record(
        tx,
        tenant,
        removeTemplate ? 'deleted' : 'draft_discarded',
        id,
        { name: row.name, version: draft.version },
        ip,
      );
      return removeTemplate;
    });
    return removed ? { deleted: true as const } : this.get(tenant, id);
  }

  /**
   * Freezes the draft and makes it the version new notes use. The form must be
   * complete, and fields kept from earlier versions must keep their types.
   */
  async publish(tenant: TenantContext, id: string, ip: string | null) {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, tenant, id);
      if (row.status === SessionNoteTemplateStatus.ARCHIVED) throw archived();
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
        await tx.sessionNoteTemplateVersion.update({
          where: { id: row.publishedVersionId },
          data: { status: TemplateVersionStatus.SUPERSEDED },
        });
      }
      await tx.sessionNoteTemplateVersion.update({
        where: { id: draft.id },
        data: {
          status: TemplateVersionStatus.PUBLISHED,
          // Stored normalized, exactly as validated.
          definition: parsed.definition as unknown as Prisma.InputJsonValue,
          publishedAt: now,
          publishedById: tenant.userId,
        },
      });
      await tx.sessionNoteTemplate.update({
        where: { id },
        data: {
          status: SessionNoteTemplateStatus.PUBLISHED,
          publishedVersionId: draft.id,
        },
      });
      await this.record(
        tx,
        tenant,
        'published',
        id,
        { name: row.name, version: draft.version },
        ip,
      );
    });
    return this.get(tenant, id);
  }

  /** No new notes from it, and it stops being a default; existing notes keep their form. */
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
      const isArchived = row.status === SessionNoteTemplateStatus.ARCHIVED;
      if (isArchived === archive) return;
      await tx.sessionNoteTemplate.update({
        where: { id },
        data: archive
          ? {
              status: SessionNoteTemplateStatus.ARCHIVED,
              archivedAt: new Date(),
              isDefault: false,
            }
          : {
              status: row.publishedVersionId
                ? SessionNoteTemplateStatus.PUBLISHED
                : SessionNoteTemplateStatus.DRAFT,
              archivedAt: null,
            },
      });
      await this.record(
        tx,
        tenant,
        archive ? 'archived' : 'restored',
        id,
        { name: row.name },
        ip,
      );
    });
    return this.get(tenant, id);
  }
}
