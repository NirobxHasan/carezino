import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/** Argon2id with OWASP's recommended minimum parameters (19 MiB, 2 iterations). */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} satisfies argon2.HashOptions;

@Injectable()
export class PasswordService {
  /** Compared against when the email is unknown, so response time doesn't reveal accounts. */
  private dummyHash?: Promise<string>;

  hash(password: string): Promise<string> {
    return argon2.hash(password, { ...OPTIONS, raw: false });
  }

  async verify(hash: string | null | undefined, password: string) {
    if (!hash) {
      this.dummyHash ??= this.hash('carezino-timing-equalizer');
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      return false;
    }
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}
