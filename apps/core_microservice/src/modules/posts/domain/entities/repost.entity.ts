import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TypeormEntityBase } from '@repo/shared';
import type { Post } from './post.entity';

/**
 * A user's re-post of an existing published post to their own feed, retaining
 * attribution to the original author. A repost is a distinct aggregate that
 * references a `Post`; it is not a lifecycle state of `Post`.
 */
@Entity('reposts')
@Index(['originalPostId', 'authorId'], { unique: true })
export class Repost extends TypeormEntityBase {
  @Column({ type: 'uuid' })
  originalPostId!: string;

  @ManyToOne('Post', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'originalPostId' })
  originalPost!: Post;

  /** The re-poster (auth user id). */
  @Index()
  @Column({ type: 'uuid' })
  authorId!: string;

  /** Factory: build a repost of a post by a user. */
  static create(originalPostId: string, authorId: string): Repost {
    const repost = new Repost();
    repost.originalPostId = originalPostId;
    repost.authorId = authorId;
    return repost;
  }
}
