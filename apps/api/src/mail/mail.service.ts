import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { AppConfig } from '../config/app-config';

interface Message {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends transactional email over SMTP when SMTP_HOST is configured. Without it, nothing
 * is sent and callers are told so: in development the message (including its link) is
 * written to the console so flows can be tested; in production only a warning is logged.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter?: Transporter;

  constructor(private readonly config: AppConfig) {}

  get configured() {
    return this.config.smtp !== null;
  }

  /** Returns true only when the SMTP server accepted the message. Never throws. */
  async send(message: Message): Promise<boolean> {
    const smtp = this.config.smtp;
    if (!smtp) {
      if (this.config.isProduction) {
        this.logger.warn(
          `Email "${message.subject}" was not sent: SMTP is not configured.`,
        );
      } else {
        this.logger.warn(
          `SMTP is not configured, so this email was NOT sent (development only):\n` +
            `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
        );
      }
      return false;
    }
    this.transporter ??= createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
    try {
      await this.transporter.sendMail({
        from: this.config.mailFrom,
        ...message,
      });
      return true;
    } catch (error) {
      // The message body holds a one-time link, so only the failure reason is logged.
      this.logger.error(
        `Email "${message.subject}" could not be sent: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return false;
    }
  }

  sendPasswordReset(
    to: string,
    name: string,
    link: string,
    ttlMinutes: number,
  ) {
    return this.send({
      to,
      subject: 'Reset your Carezino password',
      text:
        `Hi ${name},\n\nWe received a request to reset your Carezino password. ` +
        `Use the link below within ${ttlMinutes} minutes to choose a new one:\n\n${link}\n\n` +
        `If you didn't ask for this, you can ignore this email; your password won't change.`,
    });
  }

  sendInvitation(
    to: string,
    opts: {
      name: string;
      centerName: string;
      inviterName: string;
      link: string;
      ttlDays: number;
    },
  ) {
    return this.send({
      to,
      subject: `You're invited to join ${opts.centerName} on Carezino`,
      text:
        `Hi ${opts.name},\n\n${opts.inviterName} has invited you to join ${opts.centerName} on Carezino.\n\n` +
        `Accept the invitation within ${opts.ttlDays} days:\n\n${opts.link}\n\n` +
        `If you weren't expecting this, you can ignore this email.`,
    });
  }
}
