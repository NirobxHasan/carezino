import type { Prisma } from '../generated/prisma/client';

/**
 * Takes the next number of a per-center sequence, e.g. ("patient") → 42. The upsert
 * locks the counter row until the transaction ends, so concurrent callers queue up and
 * each gets its own number; if the transaction rolls back, so does the increment.
 */
export async function nextSequenceValue(
  tx: Prisma.TransactionClient,
  centerId: string,
  name: string,
) {
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "CenterSequence" ("centerId", "name", "lastValue")
    VALUES (${centerId}::uuid, ${name}, 1)
    ON CONFLICT ("centerId", "name")
    DO UPDATE SET "lastValue" = "CenterSequence"."lastValue" + 1
    RETURNING "lastValue"`;
  return rows[0].lastValue;
}
