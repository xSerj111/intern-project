import type { IHashtagFeedQuery } from '@repo/contracts';
import { FeedQueryDto } from './feed-query.dto';

/**
 * Cursor and limit rules are exactly the feed's, so the validators are
 * inherited rather than copied (`page` is likewise rejected).
 */
export class HashtagFeedQueryDto
  extends FeedQueryDto
  implements IHashtagFeedQuery {}
