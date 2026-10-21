import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import * as dotenv from 'dotenv';
import { DataSource, type EntityManager } from 'typeorm';
import { corePostgresConnection } from './../src/database/database.config';
import { OutboxEvent } from './../src/common/messaging/outbox-event.entity';
import { TypeOrmOutboxAdapter } from './../src/common/messaging/typeorm-outbox.adapter';
import { UserProfile } from './../src/modules/profiles/domain/entities/user-profile.entity';
import { UserProfileRepository } from './../src/modules/profiles/infrastructure/repository/user-profile.repository';
import { Post } from './../src/modules/posts/domain/entities/post.entity';
import { PostRepository } from './../src/modules/posts/infrastructure/repository/post.repository';
import { Comment } from './../src/modules/comments/domain/entities/comment.entity';
import { CommentRepository } from './../src/modules/comments/infrastructure/repository/comment.repository';
import { Follow } from './../src/modules/follows/domain/entities/follow.entity';
import { FollowRepository } from './../src/modules/follows/infrastructure/repository/follow.repository';
import { PostLike } from './../src/modules/posts/domain/entities/post-like.entity';
import { CommentLike } from './../src/modules/comments/domain/entities/comment-like.entity';
import { PostLikeRepository } from './../src/modules/likes/infrastructure/repository/post-like.repository';
import { CommentLikeRepository } from './../src/modules/likes/infrastructure/repository/comment-like.repository';
import { Asset } from './../src/modules/assets/domain/entities/asset.entity';
import { Chat } from './../src/modules/chats/domain/entities/chat.entity';
import { ChatParticipant } from './../src/modules/chats/domain/entities/chat-participant.entity';
import { Message } from './../src/modules/chats/domain/entities/message.entity';
import { MessageAttachment } from './../src/modules/chats/domain/entities/message-attachment.entity';
import {
  ChatRepository,
  loadAttachments,
} from './../src/modules/chats/infrastructure/repository/chat.repository';

dotenv.config({ path: join(__dirname, '../../../.env') });

jest.setTimeout(60000);

/** Thrown inside a transaction callback to force a rollback. */
class Rollback extends Error {}

/** Sorts before any row a running dev relay could be holding. */
const FIXTURE_OCCURRED_AT = new Date('1990-01-01T00:00:00Z');
const FIXTURE_ROUTING_KEY = 'b14.repos.fixture';

describe('B14 repositories against real Postgres (e2e)', () => {
  let db: DataSource;
  let outbox: TypeOrmOutboxAdapter;
  let postRepo: PostRepository;
  let commentRepo: CommentRepository;
  let followRepo: FollowRepository;
  let postLikeRepo: PostLikeRepository;
  let commentLikeRepo: CommentLikeRepository;
  let chatRepo: ChatRepository;
  let profileRepo: UserProfileRepository;

  const tag = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const postIds: string[] = [];
  const chatIds: string[] = [];
  const assetIds: string[] = [];
  const followerIds: string[] = [];

  const newUser = async (name: string): Promise<string> => {
    const authUserId = randomUUID();
    await db.getRepository(UserProfile).save(
      UserProfile.create({
        authUserId,
        username: `b14-${tag}-${name}`,
      }),
    );
    userIds.push(authUserId);
    return authUserId;
  };

  const newPost = async (authorId: string): Promise<Post> => {
    const post = await db
      .getRepository(Post)
      .save(Post.create({ authorId, content: `b14 post ${tag}` }));
    postIds.push(post.id);
    return post;
  };

  const newComment = (postId: string, authorId: string): Promise<Comment> =>
    db
      .getRepository(Comment)
      .save(
        Comment.create({ postId, authorId, content: `b14 comment ${tag}` }),
      );

  /** Runs `work` in a transaction and rolls it back; returns what it produced. */
  const inRolledBackTx = async <T>(
    work: (tx: EntityManager) => Promise<T>,
  ): Promise<T> => {
    let result!: T;
    await expect(
      db.transaction(async (tx) => {
        result = await work(tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    return result;
  };

  const count = async (sql: string, params: unknown[]): Promise<number> => {
    const rows: { n: string }[] = await db.query(sql, params);
    return Number(rows[0].n);
  };

  beforeAll(async () => {
    db = new DataSource({
      ...corePostgresConnection(),
      entities: [join(__dirname, '../src/**/*.entity.ts')],
    });
    await db.initialize();

    outbox = new TypeOrmOutboxAdapter(db.getRepository(OutboxEvent));
    postRepo = new PostRepository(db.getRepository(Post));
    commentRepo = new CommentRepository(db.getRepository(Comment));
    followRepo = new FollowRepository(db.getRepository(Follow));
    postLikeRepo = new PostLikeRepository(db.getRepository(PostLike));
    commentLikeRepo = new CommentLikeRepository(db.getRepository(CommentLike));
    profileRepo = new UserProfileRepository(db.getRepository(UserProfile));
    chatRepo = new ChatRepository(
      db.getRepository(Chat),
      db.getRepository(ChatParticipant),
      db,
    );
  });

  afterAll(async () => {
    if (!db?.isInitialized) return;
    try {
      if (chatIds.length) {
        await db.query('DELETE FROM chats WHERE id = ANY($1)', [chatIds]);
      }
      if (assetIds.length) {
        await db.query('DELETE FROM assets WHERE id = ANY($1)', [assetIds]);
      }
      // Comments and likes go with their posts (ON DELETE CASCADE).
      if (postIds.length) {
        await db.query('DELETE FROM posts WHERE id = ANY($1)', [postIds]);
      }
      if (followerIds.length) {
        await db.query('DELETE FROM follows WHERE "followerId" = ANY($1)', [
          followerIds,
        ]);
      }
      await db.query(
        'DELETE FROM outbox_events WHERE "routingKey" = $1 AND "occurredAt" = $2',
        [FIXTURE_ROUTING_KEY, FIXTURE_OCCURRED_AT],
      );
      if (userIds.length) {
        await db.query(
          'DELETE FROM user_profiles WHERE "authUserId" = ANY($1)',
          [userIds],
        );
      }
    } catch (err) {
      console.warn('b14-repos cleanup failed', err);
    }
    await db.destroy();
  });

  describe('TypeOrmOutboxAdapter', () => {
    // Fixtures are written and read inside one transaction that is rolled back,
    // so a relay running against the same database never sees them.
    const insertRow = async (
      tx: EntityManager,
      overrides: Partial<OutboxEvent> = {},
    ): Promise<string> => {
      const result = await tx.insert(OutboxEvent, {
        routingKey: FIXTURE_ROUTING_KEY,
        payload: { fixture: true },
        occurredAt: FIXTURE_OCCURRED_AT,
        ...overrides,
      });
      return (result.identifiers[0] as { id: string }).id;
    };
    const claimedIds = async (tx: EntityManager): Promise<string[]> =>
      (await outbox.claimPending(50, tx)).map((row) => row.id);
    const reload = (tx: EntityManager, id: string) =>
      tx.findOneByOrFail(OutboxEvent, { id });

    it('claimPending returns pending rows and skips published and dead-lettered ones', async () => {
      const claimed = await inRolledBackTx(async (tx) => {
        const pending = await insertRow(tx);
        const published = await insertRow(tx, { publishedAt: new Date() });
        const dead = await insertRow(tx, { deadLetteredAt: new Date() });
        return { pending, published, dead, ids: await claimedIds(tx) };
      });

      expect(claimed.ids).toContain(claimed.pending);
      expect(claimed.ids).not.toContain(claimed.published);
      expect(claimed.ids).not.toContain(claimed.dead);
    });

    it('markDead sets deadLetteredAt, bumps attempts, records the error and stops claiming the row', async () => {
      const result = await inRolledBackTx(async (tx) => {
        const id = await insertRow(tx);
        expect(await claimedIds(tx)).toContain(id);

        await outbox.markDead(id, 'broker rejected', tx);
        return { row: await reload(tx, id), claimed: await claimedIds(tx), id };
      });

      expect(result.row.deadLetteredAt).toBeInstanceOf(Date);
      expect(result.row.publishedAt).toBeNull();
      expect(result.row.attempts).toBe(1);
      expect(result.row.lastError).toBe('broker rejected');
      expect(result.claimed).not.toContain(result.id);
    });

    it('recordError records lastError without bumping attempts or dead-lettering, and keeps the row claimable', async () => {
      const result = await inRolledBackTx(async (tx) => {
        const id = await insertRow(tx, { attempts: 4 });

        await outbox.recordError(id, 'broker unreachable', tx);
        await outbox.recordError(id, 'broker still down', tx);
        return { row: await reload(tx, id), claimed: await claimedIds(tx), id };
      });

      expect(result.row.lastError).toBe('broker still down');
      expect(result.row.attempts).toBe(4);
      expect(result.row.deadLetteredAt).toBeNull();
      expect(result.row.publishedAt).toBeNull();
      expect(result.claimed).toContain(result.id);
    });
  });

  describe('ChatRepository attachments for chat-list previews', () => {
    let alice: string;
    let bob: string;
    let chatA: Chat;
    let chatB: Chat;
    let previewA: Message;
    let previewB: Message;
    let attachA: string[];

    const newAsset = async (originalName: string): Promise<string> => {
      const asset = await db.getRepository(Asset).save(
        Asset.createPrivate({
          uploaderId: alice,
          bucket: 'b14-test',
          storageKey: `b14/${tag}/${randomUUID()}`,
          mimeType: 'image/png',
          size: 123,
          originalName,
        }),
      );
      assetIds.push(asset.id);
      return asset.id;
    };

    const newDirectChat = async (a: string, b: string): Promise<Chat> => {
      const chat = await db.getRepository(Chat).save(Chat.createDirect(a, b));
      chatIds.push(chat.id);
      return chat;
    };

    const addMessage = (
      chatId: string,
      seq: number,
      content: string,
    ): Promise<Message> =>
      db.getRepository(Message).save(
        Message.create({
          chatId,
          authorId: alice,
          content,
          seq,
          clientMessageId: randomUUID(),
        }),
      );

    const attach = async (
      messageId: string,
      assetId: string,
      displayOrder: number,
    ): Promise<void> => {
      await db
        .getRepository(MessageAttachment)
        .insert({ messageId, assetId, displayOrder });
    };

    beforeAll(async () => {
      alice = await newUser('alice');
      bob = await newUser('bob');
      const carol = await newUser('carol');
      chatA = await newDirectChat(alice, bob);
      chatB = await newDirectChat(alice, carol);

      await addMessage(chatA.id, 1, 'older, no files');
      previewA = await addMessage(chatA.id, 2, 'latest with files');
      previewB = await addMessage(chatB.id, 1, 'latest without files');

      // Inserted out of display order on purpose.
      const second = await newAsset('second.png');
      const first = await newAsset('first.png');
      await attach(previewA.id, second, 1);
      await attach(previewA.id, first, 0);
      attachA = [first, second];
    });

    it('loadAttachments batch-loads links in display order and leaves attachment-free messages empty', async () => {
      const messages = await db
        .getRepository(Message)
        .find({ where: [{ id: previewA.id }, { id: previewB.id }] });
      const spy = jest.spyOn(db.manager, 'getRepository');

      await loadAttachments(messages, db.manager);

      const linkLookups = spy.mock.calls.filter(
        ([target]) => target === MessageAttachment,
      );
      spy.mockRestore();
      expect(linkLookups).toHaveLength(1);

      const withFiles = messages.find((m) => m.id === previewA.id)!;
      const without = messages.find((m) => m.id === previewB.id)!;
      expect(withFiles.attachmentIds).toEqual(attachA);
      expect(withFiles.attachments.map((a) => a.displayOrder)).toEqual([0, 1]);
      expect(withFiles.attachments.map((a) => a.originalName)).toEqual([
        'first.png',
        'second.png',
      ]);
      expect(withFiles.attachments[0]).toMatchObject({
        mimeType: 'image/png',
        size: 123,
      });
      expect(withFiles.attachments[0].storageKey).toContain(`b14/${tag}/`);
      expect(without.attachmentIds).toEqual([]);
      expect(without.attachments).toEqual([]);
    });

    it('loadAttachments skips deleted messages without querying when none are live', async () => {
      const tombstone = await db
        .getRepository(Message)
        .findOneByOrFail({ id: previewA.id });
      tombstone.deletedAt = new Date();
      tombstone.attachmentIds = ['stale'];
      const spy = jest.spyOn(db.manager, 'getRepository');

      await loadAttachments([tombstone], db.manager);

      const lookups = spy.mock.calls.length;
      spy.mockRestore();
      expect(lookups).toBe(0);
      expect(tombstone.attachmentIds).toEqual(['stale']);
    });

    it('listForUser attaches files to each chat lastMessage preview', async () => {
      const summaries = await chatRepo.listForUser(alice, { limit: 10 });

      const summaryA = summaries.find((s) => s.chat.id === chatA.id)!;
      const summaryB = summaries.find((s) => s.chat.id === chatB.id)!;
      expect(summaryA.lastMessage?.id).toBe(previewA.id);
      expect(summaryA.lastMessage?.attachmentIds).toEqual(attachA);
      expect(summaryA.lastMessage?.attachments).toHaveLength(2);
      expect(summaryB.lastMessage?.id).toBe(previewB.id);
      expect(summaryB.lastMessage?.attachments).toEqual([]);
    });
  });

  describe('PostRepository', () => {
    it('findById returns a live post and null once it is soft-deleted', async () => {
      const author = await newUser('post-author');
      const post = await newPost(author);

      const found = await postRepo.findById(post.id);
      expect(found?.id).toBe(post.id);
      expect(found?.authorId).toBe(author);

      await db.getRepository(Post).softDelete(post.id);

      expect(await postRepo.findById(post.id)).toBeNull();
      expect(await postRepo.findById(randomUUID())).toBeNull();
    });

    it('getLikeStats counts active likes, flags the viewer and excludes soft-deleted likes', async () => {
      const [u1, u2, u3] = await Promise.all([
        newUser('pl-1'),
        newUser('pl-2'),
        newUser('pl-3'),
      ]);
      const liked = await newPost(u1);
      const empty = await newPost(u1);

      await postLikeRepo.runInTransaction(async (tx) => {
        await postLikeRepo.like(liked.id, u1, tx);
        await postLikeRepo.like(liked.id, u2, tx);
        await postLikeRepo.like(liked.id, u3, tx);
      });
      await postLikeRepo.unlike(liked.id, u3);
      const ids = [liked.id, empty.id];

      const asU1 = await postRepo.getLikeStats(ids, u1);
      expect(asU1.get(liked.id)).toEqual({ likeCount: 2, likedByMe: true });
      expect(asU1.get(empty.id)).toEqual({ likeCount: 0, likedByMe: false });

      // u3's like is soft-deleted: not counted, not "mine".
      const asU3 = await postRepo.getLikeStats(ids, u3);
      expect(asU3.get(liked.id)).toEqual({ likeCount: 2, likedByMe: false });

      const anonymous = await postRepo.getLikeStats(ids);
      expect(anonymous.get(liked.id)).toEqual({
        likeCount: 2,
        likedByMe: false,
      });
      expect(anonymous.get(empty.id)).toEqual({
        likeCount: 0,
        likedByMe: false,
      });

      expect((await postRepo.getLikeStats([], u1)).size).toBe(0);
    });
  });

  describe('CommentRepository', () => {
    it('getLikeStats counts active likes, flags the viewer and excludes soft-deleted likes', async () => {
      const [u1, u2, u3] = await Promise.all([
        newUser('cl-1'),
        newUser('cl-2'),
        newUser('cl-3'),
      ]);
      const post = await newPost(u1);
      const liked = await newComment(post.id, u1);
      const empty = await newComment(post.id, u1);

      await commentLikeRepo.runInTransaction(async (tx) => {
        await commentLikeRepo.like(liked.id, u1, tx);
        await commentLikeRepo.like(liked.id, u2, tx);
        await commentLikeRepo.like(liked.id, u3, tx);
      });
      await commentLikeRepo.unlike(liked.id, u3);
      const ids = [liked.id, empty.id];

      const asU1 = await commentRepo.getLikeStats(ids, u1);
      expect(asU1.get(liked.id)).toEqual({ likeCount: 2, likedByMe: true });
      expect(asU1.get(empty.id)).toEqual({ likeCount: 0, likedByMe: false });

      const asU3 = await commentRepo.getLikeStats(ids, u3);
      expect(asU3.get(liked.id)).toEqual({ likeCount: 2, likedByMe: false });

      const anonymous = await commentRepo.getLikeStats(ids);
      expect(anonymous.get(liked.id)).toEqual({
        likeCount: 2,
        likedByMe: false,
      });

      expect((await commentRepo.getLikeStats([])).size).toBe(0);
    });

    it('runInTransaction commits comments saved through save(c, tx)', async () => {
      const author = await newUser('c-commit');
      const post = await newPost(author);

      const saved = await commentRepo.runInTransaction((tx) =>
        commentRepo.save(
          Comment.create({
            postId: post.id,
            authorId: author,
            content: 'committed',
          }),
          tx,
        ),
      );

      expect(saved.id).toBeDefined();
      expect(
        await count('SELECT COUNT(*) AS n FROM comments WHERE id = $1', [
          saved.id,
        ]),
      ).toBe(1);
    });

    it('save(c, tx) persists nothing when the surrounding transaction rolls back', async () => {
      const author = await newUser('c-rollback');
      const post = await newPost(author);
      const content = `rolled back ${randomUUID()}`;

      let savedId = '';
      await expect(
        commentRepo.runInTransaction(async (tx) => {
          const saved = await commentRepo.save(
            Comment.create({ postId: post.id, authorId: author, content }),
            tx,
          );
          savedId = saved.id;
          // Visible to the transaction itself, so the save really happened.
          expect(
            await tx.getRepository(Comment).countBy({ id: saved.id }),
          ).toBe(1);
          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);

      expect(savedId).not.toBe('');
      expect(
        await count('SELECT COUNT(*) AS n FROM comments WHERE content = $1', [
          content,
        ]),
      ).toBe(0);
    });
  });

  describe('FollowRepository', () => {
    it('runInTransaction commits follows saved through save(f, tx)', async () => {
      const follower = randomUUID();
      const following = randomUUID();
      followerIds.push(follower);

      const saved = await followRepo.runInTransaction((tx) =>
        followRepo.save(
          Follow.create({ followerId: follower, followingId: following }),
          tx,
        ),
      );

      expect(saved.id).toBeDefined();
      expect(
        (await followRepo.findByFollowerAndFollowing(follower, following))?.id,
      ).toBe(saved.id);
    });

    it('save(f, tx) persists nothing when the surrounding transaction rolls back', async () => {
      const follower = randomUUID();
      const following = randomUUID();
      followerIds.push(follower);

      await expect(
        followRepo.runInTransaction(async (tx) => {
          await followRepo.save(
            Follow.create({ followerId: follower, followingId: following }),
            tx,
          );
          expect(
            await tx.getRepository(Follow).countBy({ followerId: follower }),
          ).toBe(1);
          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);

      expect(
        await followRepo.findByFollowerAndFollowing(follower, following),
      ).toBeNull();
      expect(
        await count(
          'SELECT COUNT(*) AS n FROM follows WHERE "followerId" = $1',
          [follower],
        ),
      ).toBe(0);
    });
  });

  describe('like repositories runInTransaction', () => {
    it('PostLikeRepository commits on success and rolls back on throw', async () => {
      const user = await newUser('pl-tx');
      const post = await newPost(user);
      const rolledBack = await newPost(user);

      const result = await postLikeRepo.runInTransaction((tx) =>
        postLikeRepo.like(post.id, user, tx),
      );
      expect(result).toEqual({ inserted: true });
      expect(await postLikeRepo.count(post.id)).toBe(1);
      expect(await postLikeRepo.likedBy(post.id, user)).toBe(true);

      await expect(
        postLikeRepo.runInTransaction(async (tx) => {
          await postLikeRepo.like(rolledBack.id, user, tx);
          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);
      expect(await postLikeRepo.count(rolledBack.id)).toBe(0);
    });

    it('CommentLikeRepository commits on success and rolls back on throw', async () => {
      const user = await newUser('cl-tx');
      const post = await newPost(user);
      const comment = await newComment(post.id, user);
      const rolledBack = await newComment(post.id, user);

      const result = await commentLikeRepo.runInTransaction((tx) =>
        commentLikeRepo.like(comment.id, user, tx),
      );
      expect(result).toEqual({ inserted: true });
      expect(await commentLikeRepo.count(comment.id)).toBe(1);
      expect(await commentLikeRepo.likedBy(comment.id, user)).toBe(true);

      await expect(
        commentLikeRepo.runInTransaction(async (tx) => {
          await commentLikeRepo.like(rolledBack.id, user, tx);
          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);
      expect(await commentLikeRepo.count(rolledBack.id)).toBe(0);
    });
  });

  describe('UserProfileRepository.searchByUsername', () => {
    // Every username starts with `sq<tag>` so a search cannot see other data.
    const base = `sq${tag}`;
    const named = async (username: string): Promise<string> => {
      const authUserId = randomUUID();
      await db
        .getRepository(UserProfile)
        .save(UserProfile.create({ authUserId, username }));
      userIds.push(authUserId);
      return username;
    };
    const search = async (q: string, limit = 20): Promise<string[]> =>
      (await profileRepo.searchByUsername(q, limit, randomUUID())).map(
        (p) => p.username,
      );

    beforeAll(async () => {
      for (const name of [
        `${base}ab_c1`,
        `${base}abXc2`,
        `${base}a%d3`,
        `${base}aZZd4`,
        `${base}e\\f5`,
        `${base}eXf6`,
        `${base}Mixed7`,
      ]) {
        await named(name);
      }
    });

    it('matches "_" literally, not as a single-character wildcard', async () => {
      expect(await search(`${base}ab_c`)).toEqual([`${base}ab_c1`]);
    });

    it('matches "%" literally, not as a wildcard', async () => {
      expect(await search(`${base}a%`)).toEqual([`${base}a%d3`]);
      expect(await search(`${base}a%d`)).toEqual([`${base}a%d3`]);
    });

    it('matches a backslash literally', async () => {
      expect(await search(`${base}e\\`)).toEqual([`${base}e\\f5`]);
      expect(await search(`${base}e\\f`)).toEqual([`${base}e\\f5`]);
    });

    it('a query of only wildcards matches nothing instead of everything', async () => {
      expect(await search(`${base}%`)).toEqual([]);
      expect(await search(`${base}_`)).toEqual([]);
    });

    it('stays a case-insensitive prefix search, regardless of case', async () => {
      expect(await search(`${base}MIXED`)).toEqual([`${base}Mixed7`]);
      expect((await search(base.toUpperCase())).sort()).toEqual(
        [
          `${base}Mixed7`,
          `${base}a%d3`,
          `${base}aZZd4`,
          `${base}ab_c1`,
          `${base}abXc2`,
          `${base}e\\f5`,
          `${base}eXf6`,
        ].sort(),
      );
      // a prefix only: a middle fragment does not match
      expect(await search('ixed7')).toEqual([]);
    });

    it('applies the limit and excludes the requesting user', async () => {
      expect(await search(base, 3)).toHaveLength(3);
      const [{ authUserId, username }] = await profileRepo.searchByUsername(
        `${base}Mixed`,
        5,
        randomUUID(),
      );
      const rest = await profileRepo.searchByUsername(
        `${base}Mixed`,
        5,
        authUserId,
      );
      expect(username).toBe(`${base}Mixed7`);
      expect(rest).toEqual([]);
    });
  });
});
