import type { Comment } from '../entities/comment.entity';

export interface CommentThreadNode {
  comment: Comment;
  likesCount: number;
  isLiked: boolean;
  replies: CommentThreadNode[];
}
