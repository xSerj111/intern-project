import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { DomainError, TypeormEntityBase } from '@repo/shared';
// Type-only, string-target relations: no runtime coupling to other modules.
import type { Comment } from '../../../comments/domain/entities/comment.entity';
import type { UserProfile } from '../../../profiles/domain/entities/user-profile.entity';
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

@Entity('posts')
export class Post extends TypeormEntityBase {
  @Index()
  @Column({ type: 'uuid' })
  authorId!: string;

  @ManyToOne('UserProfile')
  @JoinColumn({ name: 'authorId', referencedColumnName: 'authUserId' })
  author!: UserProfile;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'enum', enum: PostStatus, default: PostStatus.Draft })
  status!: PostStatus;

  @OneToMany('Comment', 'post')
  comments!: Comment[];

  @OneToMany('PostAsset', 'post', { cascade: true })
  assets!: PostAsset[];

  /** Factory: a new post always starts as a draft. */
  static create(props: {
    authorId: string;
    content?: string;
    assets?: PostAsset[];
  }): Post {
    const post = new Post();
    post.authorId = props.authorId;
    post.content = props.content ?? '';
    post.status = PostStatus.Draft;

    if (props.assets) {
      post.assets = props.assets;
    }
    return post;
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
}
