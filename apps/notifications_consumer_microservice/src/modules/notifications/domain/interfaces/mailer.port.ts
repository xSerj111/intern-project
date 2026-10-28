export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface IMailer {
  /** Rejects when delivery fails so the caller can record the attempt. */
  send(message: MailMessage): Promise<void>;
}

export const MAILER = Symbol.for('IMailer');
