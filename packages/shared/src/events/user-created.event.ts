export class UserCreatedEvent {
  constructor(
    public readonly authUserId: string,
    public readonly email: string,
    public readonly handle: string,
    public readonly timestamp: Date,
  ) {}
}
