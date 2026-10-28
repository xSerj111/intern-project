import { registerDecorator, ValidationOptions } from 'class-validator';
import { FeedCursor } from '../domain/feed-cursor';

export function IsFeedCursor(options?: ValidationOptions): PropertyDecorator {
  return (object, propertyName) =>
    registerDecorator({
      name: 'isFeedCursor',
      target: object.constructor,
      propertyName: propertyName as string,
      options: { message: 'cursor is invalid', ...options },
      validator: {
        validate: (value: unknown) => FeedCursor.decode(value) !== null,
      },
    });
}
