import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { IChatUser, IOffsetPage } from '@repo/contracts';
import {
  type ActorSnapshot,
  CreateCommentDto,
  DatabaseQueryError,
  DomainError,
  EntityByIdNotFoundError,
  LoggerKey,
  type Logger,
  type PostCommentedPayload,
  RoutingKeys,
  UpdateCommentDto,
} from '@repo/shared';
import {
  OUTBOX_PORT,
  type IOutboxPort,
} from '../../common/messaging/outbox.port';
import {
  POST_REPOSITORY,
  type IPostRepository,
  type LikeStats,
} from '../posts/domain/interfaces/post-repository.port';
import {
  USER_DIRECTORY_PORT,
  type IUserDirectoryPort,
} from '../profiles/domain/interfaces/user-directory.port';
import { Comment } from './domain/entities/comment.entity';
import {
  COMMENT_REPOSITORY,
  type CommentTransaction,
  type ICommentRepository,
} from './domain/interfaces/comment-repository.port';

@Injectable()
export class CommentsService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    @Inject(COMMENT_REPOSITORY)
    private readonly commentRepository: ICommentRepository,
    @Inject(POST_REPOSITORY) private readonly postRepository: IPostRepository,
    @Inject(OUTBOX_PORT) private readonly outbox: IOutboxPort,
    @Inject(USER_DIRECTORY_PORT)
    private readonly userDirectory: IUserDirectoryPort,
  ) {}

  async createComment(
    authorId: string,
    createCommentDto: CreateCommentDto,
  ): Promise<Comment> {
    const comment = Comment.create({
      authorId,
      postId: createCommentDto.postId,
      parentId: createCommentDto.parentId,
      content: createCommentDto.content,
    });
    const post = await this.postRepository.findById(comment.postId);
    if (!post) {
      throw new EntityByIdNotFoundError('Post', comment.postId);
    }

    const actor = comment.notifiesPostAuthor(post)
      ? await this.loadActor(authorId)
      : null;

    // The outbox row shares the comment's transaction: both commit or neither.
    const savedComment = await this.runInTransaction(async (tx) => {
      const saved = await this.commentRepository.save(comment, tx);
      if (actor) {
        const payload: PostCommentedPayload = {
          actor,
          recipientId: post.authorId,
          postId: post.id,
          commentId: saved.id,
          excerpt: saved.excerpt(),
        };
        await this.outbox.add(RoutingKeys.POST_COMMENTED, payload, tx);
      }
      return saved;
    });
    this.logger.debug('Comment created', {
      props: { commentId: savedComment.id },
    });
    // Reload so the response carries the joined author (a saved row has none).
    return this.commentRepository.findOneByIdOrThrow(savedComment.id);
  }

  async updateComment(
    userId: string,
    id: string,
    updateCommentDto: UpdateCommentDto,
  ): Promise<Comment> {
    const comment = await this.commentRepository.findOneByIdOrThrow(id);

    if (comment.authorId !== userId) {
      throw new ForbiddenException(
        'You are not allowed to update this comment',
      );
    }

    if (updateCommentDto.content !== undefined) {
      comment.edit(updateCommentDto.content);
    }
    const updatedComment = await this.commentRepository.save(comment);
    this.logger.debug('Comment updated', {
      props: { commentId: updatedComment.id },
    });
    return updatedComment;
  }

  /**
   * One page of a post's comments: the page's root comments (newest first)
   * followed by all their replies (oldest first). `page`/`limit` and `hasMore`
   * count roots only.
   */
  async getCommentsByPost(
    postId: string,
    { page, limit }: { page: number; limit: number },
  ): Promise<IOffsetPage<Comment>> {
    const fetched = await this.commentRepository.findRootPage(postId, {
      offset: (page - 1) * limit,
      limit,
    });
    const hasMore = fetched.length > limit;
    const roots = fetched.slice(0, limit);
    const replies = await this.commentRepository.findRepliesOf(
      roots.map((root) => root.id),
    );
    this.logger.debug('Comments retrieved', {
      props: { postId, page, roots: roots.length, replies: replies.length },
    });
    return { items: [...roots, ...replies], page, limit, hasMore };
  }

  /** Like count and the viewer's own like per comment (one query); viewer optional. */
  async getLikeStats(
    commentIds: string[],
    viewerId?: string,
  ): Promise<Map<string, LikeStats>> {
    return this.commentRepository.getLikeStats(commentIds, viewerId);
  }

  /**
   * Author identities read off the comments' joined `author` relation (the
   * repository loads it); no extra query. Authors without a profile are absent.
   */
  getAuthors(comments: Comment[]): Map<string, IChatUser> {
    const authors = new Map<string, IChatUser>();
    for (const { authorId, author } of comments) {
      if (!author || authors.has(authorId)) continue;
      authors.set(authorId, {
        userId: author.authUserId,
        username: author.username,
        displayName: author.displayName,
        avatarUrl: author.avatarUrl ?? null,
      });
    }
    return authors;
  }

  async softDeleteComment(userId: string, id: string): Promise<void> {
    const comment = await this.commentRepository.findOneByIdOrThrow(id);

    if (comment.authorId !== userId) {
      throw new ForbiddenException(
        'You are not allowed to delete this comment',
      );
    }

    await this.commentRepository.softDeleteWithReplies(comment);
    this.logger.debug('Comment and its replies soft-deleted', {
      props: { commentId: comment.id },
    });
  }

  /** Snapshot of the acting user for the event; null (event skipped) if they have no profile. */
  private async loadActor(userId: string): Promise<ActorSnapshot | null> {
    const users = await this.userDirectory.getUsers([userId]);
    const user = users.get(userId);
    if (!user) {
      this.logger.warn('Skipping notification: actor has no profile', {
        props: { userId },
      });
      return null;
    }
    return { ...user };
  }

  private async runInTransaction<T>(
    work: (tx: CommentTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.commentRepository.runInTransaction(work);
    } catch (err: unknown) {
      if (err instanceof DomainError) throw err;
      this.logger.error(err instanceof Error ? err.message : String(err));
      throw new DatabaseQueryError();
    }
  }
}
