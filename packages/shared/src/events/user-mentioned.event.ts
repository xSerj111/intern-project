export class UserMentionedEvent {
  constructor(
    public readonly mentionerId: string,
    public readonly mentionedUserId: string,
    public readonly sourceType: "POST" | "COMMENT",
    public readonly sourceId: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
