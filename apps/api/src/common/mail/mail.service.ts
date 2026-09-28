// mail.service.ts sends the few emails the app needs: password-reset codes
// and invitations (SAAS_SPEC.md §5.4, §7; SMTP_URL / MAIL_FROM in §9).
import {
  Global, Injectable, Logger, Module, ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;

  /** Every message sent while no SMTP server is configured - for tests. */
  readonly outbox: Mail[] = [];

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('SMTP_URL');
    this.transport = url ? createTransport(url) : null;
  }

  /**
   * With SMTP_URL set, sends it. Without, in development and tests, logs
   * it instead - so a reset code can be read from the API's output locally.
   * In production that fallback would put secrets in the logs, so there it
   * refuses, the way unconfigured payments do.
   */
  async send(mail: Mail): Promise<void> {
    if (this.transport) {
      await this.transport.sendMail({
        from: this.config.get<string>('MAIL_FROM') ?? 'AssetSnap <no-reply@assetsnap.lk>',
        ...mail,
      });
      return;
    }
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new ServiceUnavailableException('Email is not configured yet');
    }
    this.outbox.push(mail);
    this.logger.warn(
      `SMTP_URL is not set - email not sent. To ${mail.to}: ${mail.subject}\n${mail.text}`,
    );
  }
}

// Global: auth (reset codes) and tenant (invitations) both send mail.
@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
