import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { RecipientContact } from '../../domain/entities/recipient-contact.entity';
import type { IRecipientContactRepository } from '../../domain/interfaces/recipient-contact-repository.port';

@Injectable()
export class RecipientContactRepository implements IRecipientContactRepository {
  constructor(
    @InjectRepository(RecipientContact)
    private readonly repository: Repository<RecipientContact>,
  ) {}

  findByUserId(userId: string): Promise<RecipientContact | null> {
    return this.repository.findOne({ where: { userId } });
  }

  /** Primary-key `save`: inserts a new `userId`, updates an existing one. */
  save(contact: RecipientContact): Promise<RecipientContact> {
    return this.repository.save(contact);
  }
}
