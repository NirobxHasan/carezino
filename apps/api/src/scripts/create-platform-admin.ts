/**
 * Creates the platform administrator (super admin) who signs in at /admin/login.
 * Credentials come from the environment so they never live in the repository:
 *
 *   PLATFORM_ADMIN_USERNAME=admin PLATFORM_ADMIN_PASSWORD='…' \
 *     npm run platform:create-admin -w @carezino/api
 *
 * Optional: PLATFORM_ADMIN_NAME, PLATFORM_ADMIN_EMAIL. Re-running is safe: an existing
 * admin is left alone unless --reset-password is passed, which sets the new password
 * and signs that admin out everywhere.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';

import { PasswordService } from '../auth/password.service';
import { normalizeEmail } from '../common/identifiers';
import { PASSWORD_MAX, PASSWORD_MIN } from '../common/validation';
import { PrismaClient } from '../generated/prisma/client';

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function main() {
  const username = process.env.PLATFORM_ADMIN_USERNAME?.trim().toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  const fullName =
    process.env.PLATFORM_ADMIN_NAME?.trim() || 'Platform Administrator';
  const resetPassword = process.argv.includes('--reset-password');

  if (!username || !/^[a-z0-9._-]{3,64}$/.test(username)) {
    fail(
      'Set PLATFORM_ADMIN_USERNAME (3–64 characters: letters, digits, . _ -).',
    );
  }
  if (
    !password ||
    password.length < PASSWORD_MIN ||
    password.length > PASSWORD_MAX
  ) {
    fail(
      `Set PLATFORM_ADMIN_PASSWORD (${PASSWORD_MIN}–${PASSWORD_MAX} characters).`,
    );
  }
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set.');

  // Platform admins sign in by username; the email only has to be unique.
  const email = normalizeEmail(
    process.env.PLATFORM_ADMIN_EMAIL ?? `${username}@platform.carezino.local`,
  );

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const passwords = new PasswordService();
  try {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      if (!existing.isPlatformAdmin) {
        fail(`User "${username}" exists but isn't a platform administrator.`);
      }
      if (!resetPassword) {
        console.log(
          `✔ Platform administrator "${username}" already exists. Nothing changed ` +
            '(pass --reset-password to set a new password).',
        );
        return;
      }
      await prisma.$transaction([
        prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash: await passwords.hash(password),
            status: 'ACTIVE',
          },
        }),
        prisma.session.updateMany({
          where: { userId: existing.id, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);
      console.log(`✔ Password reset for platform administrator "${username}".`);
      return;
    }

    if (await prisma.user.findUnique({ where: { email } })) {
      fail(
        `The email ${email} is already used. Set PLATFORM_ADMIN_EMAIL to another one.`,
      );
    }
    await prisma.user.create({
      data: {
        username,
        email,
        fullName,
        passwordHash: await passwords.hash(password),
        isPlatformAdmin: true,
      },
    });
    console.log(
      `✔ Created platform administrator "${username}". Sign in at /admin/login.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
