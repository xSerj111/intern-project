/** Domain props for a comment — used to type the repository's query params. */
export interface CommentProps {
  postId: string;
  parentId?: string;
  authorId: string;
  content: string;
}
