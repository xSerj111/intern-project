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

export enum PostStatus {
  Draft = 'draft',
  Published = 'published',
}

export class InvalidPostStateError extends DomainError {
  constructor(from: PostStatus) {
    super(`Cannot publish a post in state "${from}".`);
  }
}

@Entity('posts')
export class Post extends TypeormEntityBase {
  @Index()
  @Column({ type: 'uuid' })
  authorId!: string;

  @ManyToOne('UserProfile')
  @JoinColumn({ name: 'authorId' })
  author!: UserProfile;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'enum', enum: PostStatus, default: PostStatus.Draft })
  status!: PostStatus;

  @OneToMany('Comment', 'post')
  comments!: Comment[];

  /** Factory: a new post always starts as a draft. */
  static create(props: { authorId: string; content: string }): Post {
    const post = new Post();
    post.authorId = props.authorId;
    post.content = props.content;
    post.status = PostStatus.Draft;
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
}
