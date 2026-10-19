import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfigService } from '../../../../config/app-config.service';
import type { IMailer, MailMessage } from '../../domain/interfaces/mailer.port';

/** SMTP mailer (Mailpit locally). Rejects when the server refuses or is unreachable. */
@Injectable()
export class NodemailerAdapter implements IMailer, OnApplicationShutdown {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: AppConfigService) {
    const { host, port, secure, from, user, pass } = config.smtp;
    this.from = from;
    this.transporter = createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }

  onApplicationShutdown(): void {
    this.transporter.close();
  }
}
