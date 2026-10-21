import type { Prisma } from '../generated/prisma/client';

/**
 * Locks the center row until the transaction ends, so read-check-write sequences on a
 * center's configuration (uniqueness checks, ordering, defaults) can't interleave.
 */
export async function lockCenter(
  tx: Prisma.TransactionClient,
  centerId: string,
) {
  await tx.$queryRaw`SELECT id FROM "Center" WHERE id = ${centerId}::uuid FOR UPDATE`;
}
