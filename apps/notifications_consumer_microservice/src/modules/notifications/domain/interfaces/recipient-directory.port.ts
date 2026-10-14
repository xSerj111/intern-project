/** Source of recipient contact data owned by auth (cached 24 h in `recipient_contacts`). */
export interface IRecipientDirectory {
  /** The user's email, or `null` when the user is unknown. */
  getEmail(userId: string): Promise<string | null>;
}

export const RECIPIENT_DIRECTORY = Symbol.for('IRecipientDirectory');
