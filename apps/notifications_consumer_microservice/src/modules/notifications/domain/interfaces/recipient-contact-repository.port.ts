import type { RecipientContact } from '../entities/recipient-contact.entity';

export interface IRecipientContactRepository {
  findByUserId(userId: string): Promise<RecipientContact | null>;
  /** Insert or update by `userId`. */
  save(contact: RecipientContact): Promise<RecipientContact>;
}

export const RECIPIENT_CONTACT_REPOSITORY = Symbol.for(
  'IRecipientContactRepository',
);
