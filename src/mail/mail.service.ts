import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

/** SMTP mailer — same configuration contract as dali-be (MAIL_* variables). */
@Injectable()
export class MailService {
  private transporter?: Transporter;
  private readonly from: string;
  private readonly logger = new Logger(MailService.name);
  private readonly devMode: boolean;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('MAIL_HOST');
    const port = this.configService.get<string | number>('MAIL_PORT');
    const user =
      this.configService.get<string>('MAIL_USER') || this.configService.get<string>('MAIL_USERNAME');
    const pass =
      this.configService.get<string>('MAIL_PASS') || this.configService.get<string>('MAIL_PASSWORD');
    const secureRaw = this.configService.get<string | boolean>('MAIL_SECURE') || false;
    const secure = secureRaw === true || secureRaw === 'true';

    const fromEmail = this.configService.get<string>('MAIL_FROM_EMAIL') || user || '';
    const fromName = this.configService.get<string>('MAIL_FROM_NAME') || 'AfroCouture AI';
    this.from = `${fromName} <${fromEmail}>`.trim();

    // Without a host, log emails to the console instead of sending (local development).
    this.devMode = !host;

    if (!this.devMode) {
      const portNumber = port ? Number(port) : 587;
      this.transporter = nodemailer.createTransport({
        host,
        port: portNumber,
        secure: portNumber === 465 ? true : secure,
        requireTLS: portNumber === 587,
        auth: user && pass ? { user, pass } : undefined,
      });
    }
  }

  async sendMail(options: { to: string; subject: string; text?: string; html?: string }) {
    const { to, subject, text, html } = options;

    if (this.devMode || !this.transporter) {
      this.logger.warn(`[DEV MODE - No SMTP configured] Email to ${to} | Subject: "${subject}" | Body: ${text}`);
      return { messageId: 'dev-mode' };
    }

    try {
      const info = await this.transporter.sendMail({ from: this.from, to, subject, text, html });
      this.logger.debug(`Mail sent: ${info.messageId}`);
      return info;
    } catch (err) {
      this.logger.error(`Failed to send mail to ${to}`, err as Error);
      throw new InternalServerErrorException('Failed to send mail');
    }
  }
}
