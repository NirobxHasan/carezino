import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function bool(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function num(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Typed view over the environment. Every auth-related setting lives here. */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService) {}

  private get(key: string) {
    return this.config.get<string>(key);
  }

  get isProduction() {
    return this.get('NODE_ENV') === 'production';
  }

  /** Public URL of the web app, used to build links in emails. */
  get webAppUrl() {
    return (this.get('WEB_APP_URL') ?? 'http://localhost:3000').replace(
      /\/+$/,
      '',
    );
  }

  /**
   * Public self-service signup at /register. Off unless enabled: centers are normally
   * registered by a platform administrator from /admin.
   */
  get publicRegistrationEnabled() {
    return bool(this.get('PUBLIC_REGISTRATION_ENABLED'), false);
  }

  get cookieSecure() {
    return bool(this.get('COOKIE_SECURE'), this.isProduction);
  }

  /** Lifetime of a session that isn't "remembered" (cookie also ends with the browser). */
  get sessionTtlMs() {
    return num(this.get('SESSION_TTL_HOURS'), 12) * HOUR;
  }

  get rememberedSessionTtlMs() {
    return num(this.get('SESSION_REMEMBER_DAYS'), 30) * DAY;
  }

  get passwordResetTtlMs() {
    return num(this.get('PASSWORD_RESET_TTL_MINUTES'), 30) * 60 * 1000;
  }

  get invitationTtlMs() {
    return num(this.get('INVITATION_TTL_DAYS'), 7) * DAY;
  }

  get smtp() {
    const host = this.get('SMTP_HOST');
    if (!host) return null;
    return {
      host,
      port: num(this.get('SMTP_PORT'), 587),
      secure: bool(this.get('SMTP_SECURE'), false),
      user: this.get('SMTP_USER'),
      pass: this.get('SMTP_PASSWORD'),
    };
  }

  get mailFrom() {
    return this.get('MAIL_FROM') ?? 'Carezino <no-reply@carezino.local>';
  }
}
