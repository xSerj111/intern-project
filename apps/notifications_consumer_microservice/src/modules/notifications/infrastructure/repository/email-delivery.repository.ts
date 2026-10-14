import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { EmailDelivery } from '../../domain/entities/email-delivery.entity';
import type { IEmailDeliveryRepository } from '../../domain/interfaces/email-delivery-repository.port';

@Injectable()
export class EmailDeliveryRepository implements IEmailDeliveryRepository {
  constructor(
    @InjectRepository(EmailDelivery)
    private readonly repository: Repository<EmailDelivery>,
  ) {}

  findByJobId(jobId: string): Promise<EmailDelivery | null> {
    return this.repository.findOne({ where: { jobId } });
  }

  /** Primary-key `save`: inserts a new `jobId`, updates an existing one. */
  save(delivery: EmailDelivery): Promise<EmailDelivery> {
    return this.repository.save(delivery);
  }
}
