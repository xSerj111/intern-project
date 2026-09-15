import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { DomainError, TypeormEntityBase } from '@repo/shared';
// Type-only, string-target relations: no runtime coupling to other modules.
import type { Post } from '../../../posts/domain/entities/post.entity';
import type { UserProfile } from '../../../profiles/domain/entities/user-profile.entity';
import { CommentProps } from '../interfaces/comment.props';

export class EmptyCommentError extends DomainError {
  constructor() {
    super('Comment content cannot be empty.');
  }
}

@Entity('comments')
export class Comment extends TypeormEntityBase implements CommentProps {
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
  @JoinColumn({ name: 'authorId' })
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
}
