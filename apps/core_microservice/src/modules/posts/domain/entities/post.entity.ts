import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import {
  AccessDeniedError,
  DomainError,
  EntityByIdNotFoundError,
  EXCERPT_MAX_LENGTH,
  TypeormEntityBase,
} from '@repo/shared';
// Type-only, string-target relations: no runtime coupling to other modules.
import type { Comment } from '../../../comments/domain/entities/comment.entity';
import type { UserProfile } from '../../../profiles/domain/entities/user-profile.entity';
import { extractHashtags } from '../hashtags';
import { PostAsset } from './post-asset.entity';

export enum PostStatus {
  Draft = 'draft',
  Published = 'published',
  Archived = 'archived',
}

export class InvalidPostStateError extends DomainError {
  constructor(from: PostStatus) {
    super(`Cannot publish a post in state "${from}".`);
  }
}

export class PostArchiveError extends DomainError {
  constructor(from: PostStatus) {
    super(`Cannot archive a post in state "${from}".`);
  }
}

/** Someone other than the author asked for drafts or archived posts. */
export class PostStatusNotVisibleError extends AccessDeniedError {
  constructor(status: PostStatus) {
    super(`Only the author can list their ${status} posts.`);
  }
}

@Entity('posts')
export class Post extends TypeormEntityBase {
  @Index()
  @Column({ type: 'uuid' })
  authorId!: string;

  @ManyToOne('UserProfile')
  @JoinColumn({
    name: 'authorId',
    referencedColumnName: 'authUserId',
    foreignKeyConstraintName: 'FK_posts_authorId_authUserId',
  })
  author!: UserProfile;

  @Column({ type: 'text' })
  content!: string;

  /** Normalized tags found in `content`; derived, never set directly. */
  @Column('text', { array: true, default: () => "'{}'" })
  hashtags!: string[];

  @Column({ type: 'enum', enum: PostStatus, default: PostStatus.Draft })
  status!: PostStatus;

  @OneToMany('Comment', 'post')
  comments!: Comment[];

  @OneToMany('PostAsset', 'post', { cascade: true })
  assets!: PostAsset[];

  /** Factory: a new post always starts as a draft. */
  static create(props: {
    authorId: string;
    content: string;
    assets?: PostAsset[];
  }): Post {
    const post = new Post();
    post.authorId = props.authorId;
    post.content = props.content;
    post.hashtags = extractHashtags(props.content);
    post.status = PostStatus.Draft;

    if (props.assets) {
      post.assets = props.assets;
    }
    return post;
  }

  /** Replaces the body; hashtags are always re-derived from it. */
  editContent(content: string): void {
    this.content = content;
    this.hashtags = extractHashtags(content);
  }

  get canPublish(): boolean {
    return this.status === PostStatus.Draft && this.content.trim().length > 0;
  }

  publish(): void {
    if (!this.canPublish) {
      throw new InvalidPostStateError(this.status);
    }
    this.status = PostStatus.Published;
  }

  get canArchive(): boolean {
    return this.status === PostStatus.Published;
  }

  archive(): void {
    if (!this.canArchive) {
      throw new PostArchiveError(this.status);
    }
    this.status = PostStatus.Archived;
  }

  /**
   * Whether `viewerId` may list `authorId`'s posts in `status`: published posts
   * are public, every other status is visible to the author only.
   * @throws PostStatusNotVisibleError (403) otherwise
   */
  static assertStatusListableBy(
    authorId: string,
    status: PostStatus,
    viewerId: string | undefined,
  ): void {
    if (status !== PostStatus.Published && authorId !== viewerId) {
      throw new PostStatusNotVisibleError(status);
    }
  }

  /**
   * Whether `viewerId` may like this post: it must be published, or the
   * viewer's own. Hidden posts look missing rather than forbidden.
   * @throws EntityByIdNotFoundError when the post is not visible to the viewer
   */
  assertLikeableBy(viewerId: string): void {
    if (this.status !== PostStatus.Published && this.authorId !== viewerId) {
      throw new EntityByIdNotFoundError('Post', this.id);
    }
  }

  /** A like notifies the author unless they liked their own post. */
  notifiesAuthorOfLikeBy(likerId: string): boolean {
    return likerId !== this.authorId;
  }

  /** Short plain-text preview of the body for notifications. */
  excerpt(): string {
    return this.content.trim().slice(0, EXCERPT_MAX_LENGTH);
  }
}
