import { plainToInstance, Type } from 'class-transformer';
import {
  Equals,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  ValidateNested,
  validate,
} from 'class-validator';
import { ActorSnapshot } from '@repo/shared';
import type { EmailJob, EventEnvelope } from '@repo/shared';
import { PoisonMessageError } from './consumer.types';

class IncomingEnvelope {
  @IsUUID()
  eventId!: string;

  @IsString()
  @MaxLength(100)
  type!: string;

  @Equals(1)
  version!: 1;

  @IsISO8601()
  occurredAt!: string;

  @IsObject()
  payload!: object;
}

const EMAIL_KINDS = [
  'POST_COMMENTED',
  'POST_LIKED',
  'COMMENT_LIKED',
  'USER_FOLLOWED',
  'NEW_MESSAGE',
] as const;

/** Validating mirror of the `EmailJob` interface (contracts/broker-events.md). */
export class EmailJobMessage implements EmailJob {
  @IsString()
  @MaxLength(200)
  jobId!: string;

  @IsUUID()
  recipientId!: string;

  @IsIn(EMAIL_KINDS)
  kind!: EmailJob['kind'];

  @ValidateNested()
  @Type(() => ActorSnapshot)
  actor!: ActorSnapshot;

  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  link!: string;

  @IsString()
  @MaxLength(500)
  summary!: string;

  @IsOptional()
  @IsString()
  excerpt!: string | null;
}

function parseJson(content: Buffer): unknown {
  try {
    return JSON.parse(content.toString('utf8'));
  } catch {
    throw new PoisonMessageError('Message body is not valid JSON');
  }
}

async function validated<T extends object>(
  type: new () => T,
  plain: unknown,
  what: string,
): Promise<T> {
  if (typeof plain !== 'object' || plain === null || Array.isArray(plain)) {
    throw new PoisonMessageError(`${what} is not an object`);
  }
  const instance = plainToInstance(type, plain);
  const errors = await validate(instance, { whitelist: true });
  if (errors.length > 0) {
    const fields = errors.map((e) => e.property).join(', ');
    throw new PoisonMessageError(`Invalid ${what}: ${fields}`);
  }
  return instance;
}

/** Parses the envelope only; the payload is validated per routing key. */
export async function parseEnvelope(
  content: Buffer,
): Promise<EventEnvelope<object>> {
  return validated(IncomingEnvelope, parseJson(content), 'envelope');
}

export async function validatePayload<T extends object>(
  envelope: EventEnvelope<object>,
  payloadType: new () => T,
): Promise<EventEnvelope<T>> {
  const payload = await validated(payloadType, envelope.payload, 'payload');
  return { ...envelope, payload };
}

export async function parseEmailJob(content: Buffer): Promise<EmailJob> {
  return validated(EmailJobMessage, parseJson(content), 'email job');
}
