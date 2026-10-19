import type { EmailDelivery } from '../entities/email-delivery.entity';

export interface IEmailDeliveryRepository {
  findByJobId(jobId: string): Promise<EmailDelivery | null>;
  /** Insert or update by `jobId`. */
  save(delivery: EmailDelivery): Promise<EmailDelivery>;
}

export const EMAIL_DELIVERY_REPOSITORY = Symbol.for('IEmailDeliveryRepository');
