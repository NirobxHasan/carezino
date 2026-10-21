import type { Prisma } from '../generated/prisma/client';

/**
 * Starting configuration for a new center. Everything here becomes ordinary, editable
 * rows: nothing in the application depends on these names, codes or hours existing.
 */
export const DEFAULT_THERAPY_TYPES = [
  {
    code: 'OT',
    name: 'Occupational Therapy',
    description: 'Daily living, motor and sensory skills.',
    defaultDurationMinutes: 45,
    durations: [30, 45, 60],
    color: '#0d9488',
  },
  {
    code: 'ABA',
    name: 'Applied Behavior Analysis',
    description: 'Behavior, communication and social skills.',
    defaultDurationMinutes: 60,
    durations: [60, 90, 120],
    color: '#7c3aed',
  },
  {
    code: 'SLT',
    name: 'Speech & Language Therapy',
    description: 'Speech, language, communication and swallowing.',
    defaultDurationMinutes: 30,
    durations: [30, 45],
    color: '#db2777',
  },
] as const;

/** Saturday to Thursday, 09:00–18:00; Friday closed. 0 = Sunday … 6 = Saturday. */
const DEFAULT_OPEN_DAYS = [6, 0, 1, 2, 3, 4];
const DEFAULT_HOURS = { startMinutes: 9 * 60, endMinutes: 18 * 60 };

/**
 * Adds the default therapy types the center doesn't already have, matched by code or
 * name (case-insensitively), and returns how many were created. Safe to run again.
 * Callers serialize therapy type writes per center (see lockCenter).
 */
export async function seedDefaultTherapyTypes(
  tx: Prisma.TransactionClient,
  centerId: string,
) {
  const existing = await tx.therapyType.findMany({
    where: { centerId },
    select: { code: true, name: true, displayOrder: true },
  });
  const codes = new Set(existing.map((t) => t.code));
  const names = new Set(existing.map((t) => t.name.toLowerCase()));
  let order = Math.max(-1, ...existing.map((t) => t.displayOrder)) + 1;
  let created = 0;
  for (const type of DEFAULT_THERAPY_TYPES) {
    if (codes.has(type.code) || names.has(type.name.toLowerCase())) continue;
    await tx.therapyType.create({
      data: {
        centerId,
        code: type.code,
        name: type.name,
        description: type.description,
        defaultDurationMinutes: type.defaultDurationMinutes,
        color: type.color,
        displayOrder: order++,
        durationOptions: {
          create: type.durations.map((durationMinutes) => ({
            durationMinutes,
          })),
        },
      },
    });
    created++;
  }
  return created;
}

/** Creates the settings rows with their schema defaults, if they don't exist yet. */
export async function ensureSettingsRows(
  tx: Prisma.TransactionClient,
  centerId: string,
) {
  await tx.centerSchedulingSettings.createMany({
    data: [{ centerId }],
    skipDuplicates: true,
  });
  await tx.centerGeneralSettings.createMany({
    data: [{ centerId }],
    skipDuplicates: true,
  });
}

/**
 * Runs during center registration, in the same transaction. Idempotent: therapy types
 * are matched as above, hours are only added to a center that has none, and settings
 * rows are created only once.
 */
export async function initializeCenterDefaults(
  tx: Prisma.TransactionClient,
  centerId: string,
  options: { therapyTypes: boolean },
) {
  if (options.therapyTypes) await seedDefaultTherapyTypes(tx, centerId);
  const hasHours = await tx.centerWorkingHour.count({ where: { centerId } });
  if (!hasHours) {
    await tx.centerWorkingHour.createMany({
      data: DEFAULT_OPEN_DAYS.map((dayOfWeek) => ({
        centerId,
        dayOfWeek,
        ...DEFAULT_HOURS,
      })),
    });
  }
  await ensureSettingsRows(tx, centerId);
}
