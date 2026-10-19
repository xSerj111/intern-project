import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Cached contacts older than this are fetched again. */
export const RECIPIENT_CONTACT_TTL_MS = 24 * 60 * 60 * 1000;

/** Cache of auth-owned contact data (the recipient's email). */
@Entity('recipient_contacts')
export class RecipientContact {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_recipient_contacts_userId',
  })
  userId!: string;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'timestamptz' })
  fetchedAt!: Date;

  static create(userId: string, email: string, now: Date): RecipientContact {
    const contact = new RecipientContact();
    contact.userId = userId;
    contact.email = email;
    contact.fetchedAt = now;
    return contact;
  }

  /** True when the cached email is older than 24 h. */
  isStale(now: Date): boolean {
    return now.getTime() - this.fetchedAt.getTime() > RECIPIENT_CONTACT_TTL_MS;
  }

  refresh(email: string, now: Date): void {
    this.email = email;
    this.fetchedAt = now;
  }
}
