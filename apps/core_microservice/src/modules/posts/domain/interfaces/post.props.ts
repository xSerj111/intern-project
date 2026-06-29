import type { PostStatus } from '../../domain/entities/post.entity';

/** Domain props for a post — used to type the repository's query params. */
export interface PostProps {
  authorId: string;
  content: string;
  status: PostStatus;
}
