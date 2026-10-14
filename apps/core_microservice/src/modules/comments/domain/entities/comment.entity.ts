import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import {
  DomainError,
  EntityByIdNotFoundError,
  EXCERPT_MAX_LENGTH,
  TypeormEntityBase,
} from '@repo/shared';
// Type-only, string-target relations: no runtime coupling to other modules.
import type { Post } from '../../../posts/domain/entities/post.entity';
import type { UserProfile } from '../../../profiles/domain/entities/user-profile.entity';

export class EmptyCommentError extends DomainError {
  constructor() {
    super('Comment content cannot be empty.');
  }
}

@Entity('comments')
export class Comment extends TypeormEntityBase {
  @Column({ type: 'uuid' })
  postId!: string;

  @ManyToOne('Post', 'comments', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'postId' })
  post!: Post;

  // ID for the parent comment (nullable because top-level comments have no parents)
  @Column({ type: 'uuid', nullable: true })
  parentId?: string;

  // if the parent comment is deleted, nested ones are deleted too
  @ManyToOne('Comment', { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'parentId' })
  parent?: Comment;

  // Logical reference to the author's profile
  @Index()
  @Column({ type: 'uuid' })
  authorId!: string;

  @ManyToOne('UserProfile')
  @JoinColumn({ name: 'authorId', referencedColumnName: 'authUserId' })
  author!: UserProfile;

  @Column({ type: 'text' })
  content!: string;

  static create(props: {
    postId: string;
    authorId: string;
    content: string;
    parentId?: string;
  }): Comment {
    const comment = new Comment();
    comment.postId = props.postId;
    comment.authorId = props.authorId;
    comment.content = props.content;
    comment.parentId = props.parentId;
    return comment;
  }

  /** Edit the comment body, enforcing the non-empty rule. */
  edit(content: string): void {
    const next = content.trim();
    if (next.length === 0) {
      throw new EmptyCommentError();
    }
    this.content = next;
  }

  /**
   * Whether `viewerId` may like this comment: a deleted comment is gone, and a
   * comment is only as visible as its post.
   * @throws EntityByIdNotFoundError when the comment is deleted
   * @throws whatever `Post.assertLikeableBy` throws when the post is not visible
   */
  assertLikeableBy(viewerId: string, post: Post): void {
    if (this.deletedAt) {
      throw new EntityByIdNotFoundError('Comment', this.id);
    }
    post.assertLikeableBy(viewerId);
  }

  /** A like notifies the comment author unless they liked their own comment. */
  notifiesAuthorOfLikeBy(likerId: string): boolean {
    return this.authorId !== likerId;
  }

  /** Only top-level comments by someone other than the post author notify (replies don't). */
  notifiesPostAuthor(post: Post): boolean {
    return !this.parentId && this.authorId !== post.authorId;
  }

  /** Short plain-text preview of the body for notifications. */
  excerpt(): string {
    return this.content.trim().slice(0, EXCERPT_MAX_LENGTH);
  }
}
