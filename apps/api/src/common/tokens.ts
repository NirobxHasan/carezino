import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random token, URL-safe. Used for sessions, password resets and invitations. */
export function generateToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Tokens are high-entropy, so a fast hash is enough: only the hash is stored, and a
 * database leak doesn't hand out working sessions or links.
 */
export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
