import type { ThrottlerModuleOptions } from '@nestjs/throttler';

const MINUTE = 60_000;

function envLimit(key: string, fallback: number) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The account or link a request targets: an email, the registering owner's email, or a token. */
function credentialKey(req: Record<string, any>) {
  const body = (req.body ?? {}) as {
    email?: unknown;
    username?: unknown;
    owner?: { email?: unknown };
    token?: unknown;
  };
  const email =
    typeof body.email === 'string'
      ? body.email
      : typeof body.username === 'string'
        ? body.username
        : body.owner?.email;
  if (typeof email === 'string')
    return email.trim().toLowerCase().slice(0, 254);
  if (typeof body.token === 'string') return `token:${body.token.slice(0, 24)}`;
  return '';
}

/**
 * Two counters: `default` per client IP, and `credential` per IP + submitted email, so a
 * shared clinic IP doesn't lock out a whole front desk while one account is attacked.
 * The in-memory store is per process; use a shared store (e.g. Redis) when scaling out.
 */
export const throttlerOptions: ThrottlerModuleOptions = {
  throttlers: [
    {
      name: 'default',
      ttl: MINUTE,
      limit: () => envLimit('API_RATE_LIMIT_PER_MINUTE', 300),
    },
    {
      name: 'credential',
      ttl: 15 * MINUTE,
      // Effectively unlimited except where a route sets its own limit below.
      limit: 1_000_000,
      getTracker: (req) => `${String(req.ip)}|${credentialKey(req)}`,
    },
  ],
  errorMessage: 'Too many attempts. Please wait a few minutes and try again.',
};

/** For sign-in and other credential checks. */
export const CREDENTIAL_THROTTLE = {
  default: {
    limit: () => envLimit('AUTH_RATE_LIMIT_PER_MINUTE', 20),
    ttl: MINUTE,
  },
  credential: {
    limit: () => envLimit('AUTH_RATE_LIMIT_PER_ACCOUNT', 10),
    ttl: 15 * MINUTE,
  },
};

/** For endpoints that send email or create accounts. */
export const SENSITIVE_THROTTLE = {
  default: {
    limit: () => envLimit('AUTH_RATE_LIMIT_PER_MINUTE', 20),
    ttl: MINUTE,
  },
  credential: {
    limit: () => envLimit('AUTH_RATE_LIMIT_PER_ACCOUNT', 10) / 2,
    ttl: 15 * MINUTE,
  },
};
