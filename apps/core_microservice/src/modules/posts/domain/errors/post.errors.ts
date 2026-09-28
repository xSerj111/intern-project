import { DomainError } from '@repo/shared';
import type { PostStatus } from '../entities/post.entity';

/** Thrown when a post that is not published is re-posted. */
export class RepostNotAllowedError extends DomainError {
  constructor(from: PostStatus) {
    super(`Cannot repost a post in state "${from}".`);
  }
}
