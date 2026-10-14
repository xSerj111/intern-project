import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { ILikeState } from '@repo/contracts';
import {
  type ActorSnapshot,
  type CommentLikedPayload,
  type Logger,
  LoggerKey,
  type PostLikedPayload,
  RoutingKeys,
} from '@repo/shared';
import type { DataSource } from 'typeorm';

import {
  OUTBOX_PORT,
  type IOutboxPort,
} from '../../common/messaging/outbox.port';
import { CommentRepository } from '../comments/infrastructure/repository/comment.repository';
import { PostRepository } from '../posts/infrastructure/repository/post.repository';
import {
  USER_DIRECTORY_PORT,
  type IUserDirectoryPort,
} from '../profiles/domain/interfaces/user-directory.port';
import {
  COMMENT_LIKE_REPOSITORY,
  type ICommentLikeRepository,
} from './domain/interfaces/comment-like-repository.port';
import {
  POST_LIKE_REPOSITORY,
  type IPostLikeRepository,
} from './domain/interfaces/post-like-repository.port';

/**
 * Orchestrates likes: loads the item, lets the entity decide visibility and
 * whether the author is notified, and writes the outbox row in the same
 * transaction as the like. Idempotent in both directions.
 */
@Injectable()
export class LikesService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly postRepository: PostRepository,
    private readonly commentRepository: CommentRepository,
    @Inject(POST_LIKE_REPOSITORY)
    private readonly postLikes: IPostLikeRepository,
    @Inject(COMMENT_LIKE_REPOSITORY)
    private readonly commentLikes: ICommentLikeRepository,
    @Inject(USER_DIRECTORY_PORT)
    private readonly userDirectory: IUserDirectoryPort,
    @Inject(OUTBOX_PORT) private readonly outbox: IOutboxPort,
  ) {}

  async likePost(postId: string, userId: string): Promise<ILikeState> {
    const post = await this.postRepository.findOneByIdOrThrow(postId);
    post.assertLikeableBy(userId);

    await this.dataSource.transaction(async (tx) => {
      const { inserted } = await this.postLikes.like(postId, userId, tx);
      // Only a genuinely new like notifies: a restore or repeat never does.
      if (inserted && post.notifiesAuthorOfLikeBy(userId)) {
        const payload: PostLikedPayload = {
          actor: await this.actorFor(userId),
          recipientId: post.authorId,
          postId,
          excerpt: post.excerpt(),
        };
        await this.outbox.add(RoutingKeys.POST_LIKED, payload, tx);
      }
    });

    this.logger.debug('Post liked', { props: { postId, userId } });
    return { liked: true, likeCount: await this.postLikes.count(postId) };
  }

  async unlikePost(postId: string, userId: string): Promise<ILikeState> {
    // 404 for a missing post; unliking needs no visibility check (no-op if never liked).
    await this.postRepository.findOneByIdOrThrow(postId);
    await this.postLikes.unlike(postId, userId);

    this.logger.debug('Post unliked', { props: { postId, userId } });
    return { liked: false, likeCount: await this.postLikes.count(postId) };
  }

  async likeComment(commentId: string, userId: string): Promise<ILikeState> {
    const comment = await this.commentRepository.findOneByIdOrThrow(commentId);
    const post = await this.postRepository.findOneByIdOrThrow(comment.postId);
    comment.assertLikeableBy(userId, post);

    await this.dataSource.transaction(async (tx) => {
      const { inserted } = await this.commentLikes.like(commentId, userId, tx);
      if (inserted && comment.notifiesAuthorOfLikeBy(userId)) {
        const payload: CommentLikedPayload = {
          actor: await this.actorFor(userId),
          recipientId: comment.authorId,
          postId: comment.postId,
          commentId,
          excerpt: comment.excerpt(),
        };
        await this.outbox.add(RoutingKeys.COMMENT_LIKED, payload, tx);
      }
    });

    this.logger.debug('Comment liked', { props: { commentId, userId } });
    return {
      liked: true,
      likeCount: await this.commentLikes.count(commentId),
    };
  }

  async unlikeComment(commentId: string, userId: string): Promise<ILikeState> {
    await this.commentRepository.findOneByIdOrThrow(commentId);
    await this.commentLikes.unlike(commentId, userId);

    this.logger.debug('Comment unliked', { props: { commentId, userId } });
    return {
      liked: false,
      likeCount: await this.commentLikes.count(commentId),
    };
  }

  /** Profile snapshot of the liker; a missing profile must not block the like. */
  private async actorFor(userId: string): Promise<ActorSnapshot> {
    const user = (await this.userDirectory.getUsers([userId])).get(userId);
    return {
      userId,
      username: user?.username ?? 'user',
      displayName: user?.displayName ?? 'Someone',
      avatarUrl: user?.avatarUrl ?? null,
    };
  }
}
