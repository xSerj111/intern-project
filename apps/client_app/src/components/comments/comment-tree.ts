import type { ICommentResponse } from '@repo/contracts';

/** Top-level comments are depth 1; replies deeper than this stay at this depth. */
export const MAX_COMMENT_DEPTH = 3;

export interface CommentNode {
  comment: ICommentResponse;
  depth: number;
  replies: CommentNode[];
}

const byAge = (a: ICommentResponse, b: ICommentResponse) =>
  Date.parse(a.createdAt) - Date.parse(b.createdAt);

/**
 * Turn the API's flat newest-first list into a thread tree: top-level comments
 * stay newest-first, replies go oldest-first under their parent. A reply whose
 * parent is missing (e.g. deleted) is shown at top level. Replies nested deeper
 * than `maxDepth` are flattened under their depth-`maxDepth` ancestor.
 */
export function buildCommentTree(
  comments: ICommentResponse[],
  maxDepth = MAX_COMMENT_DEPTH,
): CommentNode[] {
  const ids = new Set(comments.map((comment) => comment.id));
  const children = new Map<string, ICommentResponse[]>();
  const roots: ICommentResponse[] = [];

  for (const comment of comments) {
    if (comment.parentId && ids.has(comment.parentId)) {
      const siblings = children.get(comment.parentId) ?? [];
      siblings.push(comment);
      children.set(comment.parentId, siblings);
    } else {
      roots.push(comment);
    }
  }

  const descendants = (id: string): ICommentResponse[] => {
    const found: ICommentResponse[] = [];
    const stack = [...(children.get(id) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop() as ICommentResponse;
      found.push(next);
      stack.push(...(children.get(next.id) ?? []));
    }
    return found.sort(byAge);
  };

  const build = (comment: ICommentResponse, depth: number): CommentNode => {
    if (depth >= maxDepth) {
      return {
        comment,
        depth,
        replies: descendants(comment.id).map((reply) => ({
          comment: reply,
          depth,
          replies: [],
        })),
      };
    }
    return {
      comment,
      depth,
      replies: [...(children.get(comment.id) ?? [])]
        .sort(byAge)
        .map((reply) => build(reply, depth + 1)),
    };
  };

  return roots.map((comment) => build(comment, 1));
}

/** Number of replies under a node, at any depth. */
export function countReplies(node: CommentNode): number {
  return node.replies.reduce(
    (total, reply) => total + 1 + countReplies(reply),
    0,
  );
}
