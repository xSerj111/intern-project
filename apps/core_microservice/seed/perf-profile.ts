/**
 * `--profile perf` for the core seed (research §3). Generates, from the shared
 * PRNG and base date in `seed/perf.ts`:
 *   1,000 profiles · 10,000 follows (20 popular users with 150+ followers) ·
 *   20,000 published posts (30% with 1–3 of 10 sample images, ~50% with 1–3
 *   hashtags from a Zipf-skewed pool of 200) ·
 *   50,000 comments (30% replies) · ~40,000 likes (posts + comments) ·
 *   200 chats (150 direct, 50 groups of 3–20) with 20 messages each.
 * Rows go straight into the tables, so no outbox events are produced.
 *
 *   npm run db:seed -- --profile perf           # insert missing perf rows
 *   npm run db:seed -- --profile perf --reset   # delete perf-owned rows first
 */
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Client } from 'pg';
import { deflateSync } from 'zlib';
import { extractHashtags } from '../src/modules/posts/domain/hashtags';
import {
  PERF_BASE_DATE,
  PERF_PRNG_SEED,
  PERF_SEED_VERSION,
  PERF_USER_COUNT,
  insertChunked,
  mulberry32,
  perfUserId,
  perfUserNumbers,
  perfUsername,
  seedId,
} from '../../../seed/perf';

const FOLLOW_COUNT = 10_000;
const POPULAR_EVERY = 50; // users 50, 100, … 1000 → 20 popular users
const POPULAR_MIN_FOLLOWERS = 150;
const POST_COUNT = 20_000;
const POST_IMAGE_SHARE = 0.3;
const SAMPLE_IMAGE_COUNT = 10;
const COMMENT_COUNT = 50_000;
const REPLY_SHARE = 0.3;
const POST_LIKE_COUNT = 30_000;
const COMMENT_LIKE_COUNT = 10_000;
const DIRECT_CHAT_COUNT = 150;
const GROUP_CHAT_COUNT = 50;
const MESSAGES_PER_CHAT = 20;
const POST_HASHTAG_SHARE = 0.5;
const HASHTAG_POOL_SIZE = 200;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const WORDS = (
  'coffee sketch run bread code cat sunset bridge city trail light film ' +
  'jazz book train river garden market rain mountain coast morning night ' +
  'weekend project idea photo travel kitchen music friend street bike'
).split(' ');

/**
 * Fixed hashtag pool: 20 word tags (every 10th rank) mixed with `tag001`-style
 * tags. Rank `i` is drawn with weight 1 / (i + 1), so a few tags are popular.
 */
const HASHTAG_POOL = Array.from({ length: HASHTAG_POOL_SIZE }, (_, i) =>
  i % 10 === 0 ? WORDS[i / 10] : `tag${String(i).padStart(3, '0')}`,
);

type Row = unknown[];

class Gen {
  private readonly rand = mulberry32(PERF_PRNG_SEED);

  next(): number {
    return this.rand();
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.rand() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.rand() * items.length)];
  }

  sentence(min: number, max: number): string {
    const words = Array.from({ length: this.int(min, max) }, () =>
      this.pick(WORDS),
    );
    const text = words.join(' ');
    return `${text[0].toUpperCase()}${text.slice(1)}.`;
  }

  /** A date `maxMs` or less before `to`, rounded to the second. */
  before(to: number, maxMs: number): Date {
    return new Date(Math.floor((to - this.rand() * maxMs) / 1000) * 1000);
  }

  after(from: number, maxMs: number): Date {
    return new Date(Math.floor((from + this.rand() * maxMs) / 1000) * 1000);
  }
}

/** Weighted sampling over indexes 0..weights.length-1 (binary search). */
function weightedPicker(gen: Gen, weights: number[]): () => number {
  const cumulative: number[] = [];
  let total = 0;
  for (const w of weights) cumulative.push((total += w));
  return () => {
    const target = gen.next() * total;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] > target) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
}

const isPopular = (n: number) => n % POPULAR_EVERY === 0;

// ---------------------------------------------------------------------------
// Sample images: 10 tiny solid-colour PNGs, uploaded once to the public bucket.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function solidPng(size: number, [r, g, b]: [number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // colour type: RGB
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    for (let x = 0; x < size; x++) {
      raw.writeUInt8(r, row + 1 + x * 3);
      raw.writeUInt8(g, row + 2 + x * 3);
      raw.writeUInt8(b, row + 3 + x * 3);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

interface SampleImage {
  id: string;
  key: string;
  url: string;
  body: Buffer;
}

/** Same env vars and URL shape as `AppConfigService.s3` / `S3StorageAdapter`. */
function s3Settings() {
  const endpoint = process.env.S3_ENDPOINT || 'localhost';
  const port = Number(process.env.S3_PORT || '9000');
  const useSsl = (process.env.S3_USE_SSL || 'false').toLowerCase() === 'true';
  const bucket = process.env.S3_BUCKET_NAME || 'innogram-assets';
  const protocol = useSsl ? 'https' : 'http';
  return {
    bucket,
    baseUrl: `${protocol}://${endpoint}:${port}`,
    region: process.env.S3_REGION || 'us-east-1',
    accessKey: process.env.S3_ACCESS_KEY || '',
    secretKey: process.env.S3_SECRET_KEY || '',
  };
}

function sampleImages(): SampleImage[] {
  const { baseUrl, bucket } = s3Settings();
  return Array.from({ length: SAMPLE_IMAGE_COUNT }, (_, i) => {
    const key = `perf/sample-${String(i + 1).padStart(2, '0')}.png`;
    const hue = (i * 37) % 256;
    return {
      id: seedId('asset', i + 1),
      key,
      url: `${baseUrl}/${bucket}/${key}`,
      body: solidPng(64, [hue, 255 - hue, (hue * 3) % 256]),
    };
  });
}

/** Uploads missing sample objects. Failures warn; DB rows are still seeded. */
async function uploadSampleImages(images: SampleImage[]): Promise<number> {
  const s3 = s3Settings();
  const client = new S3Client({
    endpoint: s3.baseUrl,
    region: s3.region,
    credentials: { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey },
    forcePathStyle: true,
  });
  let uploaded = 0;
  try {
    for (const img of images) {
      const exists = await client
        .send(new HeadObjectCommand({ Bucket: s3.bucket, Key: img.key }))
        .then(
          () => true,
          () => false,
        );
      if (exists) continue;
      await client.send(
        new PutObjectCommand({
          Bucket: s3.bucket,
          Key: img.key,
          Body: img.body,
          ContentType: 'image/png',
        }),
      );
      uploaded++;
    }
  } catch (err) {
    console.warn(
      `core perf seed: sample image upload failed (${err instanceof Error ? err.message : String(err)}); continuing`,
    );
  } finally {
    client.destroy();
  }
  return uploaded;
}

// ---------------------------------------------------------------------------
// Data generation. Order of PRNG calls is fixed, so output is identical per run.

interface PerfData {
  tables: { table: string; columns: string[]; rows: Row[] }[];
  chatIds: string[];
  assetIds: string[];
}

function generate(images: SampleImage[]): PerfData {
  const gen = new Gen();
  const base = PERF_BASE_DATE.getTime();
  const numbers = perfUserNumbers();
  const uid = (n: number) => perfUserId(n);
  const userCreatedAt = (n: number) => new Date(base - 400 * DAY + n * MINUTE);

  // Profiles.
  const profiles: Row[] = numbers.map((n) => {
    const at = userCreatedAt(n);
    return [
      seedId('profile', n),
      uid(n),
      perfUsername(n),
      `Perf User ${n}`,
      gen.next() < 0.6 ? gen.sentence(4, 12) : null,
      at,
      at,
    ];
  });

  // Follows: popular users first (150–209 followers each), then random pairs.
  const followPairs = new Set<string>();
  const follows: Row[] = [];
  const addFollow = (follower: number, following: number): boolean => {
    if (follower === following) return false;
    const key = `${follower}:${following}`;
    if (followPairs.has(key)) return false;
    followPairs.add(key);
    const at = gen.before(base, 365 * DAY);
    follows.push([
      seedId('follow', follows.length + 1),
      uid(follower),
      uid(following),
      at,
      at,
    ]);
    return true;
  };
  for (const popular of numbers.filter(isPopular)) {
    const target = POPULAR_MIN_FOLLOWERS + gen.int(0, 59);
    let added = 0;
    while (added < target) {
      if (addFollow(gen.int(1, PERF_USER_COUNT), popular)) added++;
    }
  }
  while (follows.length < FOLLOW_COUNT) {
    addFollow(gen.int(1, PERF_USER_COUNT), gen.int(1, PERF_USER_COUNT));
  }

  // Posts: skewed authorship (popular users post a lot, most users a little).
  const authorWeights = numbers.map((n) =>
    isPopular(n) ? 8 : 0.1 + 2 * gen.next() ** 2,
  );
  const pickAuthor = weightedPicker(gen, authorWeights);
  const pickHashtag = weightedPicker(
    gen,
    HASHTAG_POOL.map((_, i) => 1 / (i + 1)),
  );
  const posts: Row[] = [];
  const postMeta: { id: string; at: number }[] = [];
  const postAssets: Row[] = [];
  for (let i = 1; i <= POST_COUNT; i++) {
    const id = seedId('post', i);
    const at = gen.before(base, 180 * DAY);
    const authorId = uid(pickAuthor() + 1);
    let content = gen.sentence(5, 30);
    if (gen.next() < POST_HASHTAG_SHARE) {
      const wanted = gen.int(1, 3);
      const tags = new Set<string>();
      while (tags.size < wanted) tags.add(HASHTAG_POOL[pickHashtag()]);
      content += ` ${[...tags].map((t) => `#${t}`).join(' ')}`;
    }
    posts.push([
      id,
      authorId,
      content,
      extractHashtags(content),
      'published',
      at,
      at,
    ]);
    postMeta.push({ id, at: at.getTime() });
    if (gen.next() < POST_IMAGE_SHARE) {
      const count = gen.int(1, 3);
      const start = gen.int(0, SAMPLE_IMAGE_COUNT - 1);
      for (let k = 0; k < count; k++) {
        const img = images[(start + k) % SAMPLE_IMAGE_COUNT];
        postAssets.push([
          seedId('post-asset', postAssets.length + 1),
          id,
          img.id,
          k,
          at,
        ]);
      }
    }
  }

  // Engagement concentrates on a minority of posts.
  const postWeights = postMeta.map(() => 0.02 + gen.next() ** 4);
  const pickPost = weightedPicker(gen, postWeights);

  // Comments: top-level first, then replies to random top-level comments.
  const comments: Row[] = [];
  const topLevel: { id: string; postId: string; at: number }[] = [];
  const topCount = Math.round(COMMENT_COUNT * (1 - REPLY_SHARE));
  for (let i = 1; i <= COMMENT_COUNT; i++) {
    const id = seedId('comment', i);
    const author = uid(gen.int(1, PERF_USER_COUNT));
    if (i <= topCount) {
      const post = postMeta[pickPost()];
      const at = gen.after(post.at, 7 * DAY);
      comments.push([id, post.id, author, null, gen.sentence(2, 20), at, at]);
      topLevel.push({ id, postId: post.id, at: at.getTime() });
    } else {
      const parent = gen.pick(topLevel);
      const at = gen.after(parent.at, 2 * DAY);
      comments.push([
        id,
        parent.postId,
        author,
        parent.id,
        gen.sentence(1, 15),
        at,
        at,
      ]);
    }
  }

  // Likes.
  const postLikeKeys = new Set<string>();
  const postLikes: Row[] = [];
  while (postLikes.length < POST_LIKE_COUNT) {
    const post = postMeta[pickPost()];
    const user = gen.int(1, PERF_USER_COUNT);
    const key = `${post.id}:${user}`;
    if (postLikeKeys.has(key)) continue;
    postLikeKeys.add(key);
    postLikes.push([
      seedId('post-like', postLikes.length + 1),
      post.id,
      uid(user),
      gen.after(post.at, 7 * DAY),
    ]);
  }
  const commentLikeKeys = new Set<string>();
  const commentLikes: Row[] = [];
  while (commentLikes.length < COMMENT_LIKE_COUNT) {
    const comment = gen.pick(topLevel);
    const user = gen.int(1, PERF_USER_COUNT);
    const key = `${comment.id}:${user}`;
    if (commentLikeKeys.has(key)) continue;
    commentLikeKeys.add(key);
    commentLikes.push([
      seedId('comment-like', commentLikes.length + 1),
      comment.id,
      uid(user),
      gen.after(comment.at, 2 * DAY),
    ]);
  }

  // Chats: participants, messages seq 1..20, chats.lastSeq = 20,
  // participants' lastReadSeq in 0..lastSeq (an author has read its own).
  const chats: Row[] = [];
  const participants: Row[] = [];
  const messages: Row[] = [];
  const chatIds: string[] = [];
  const directKeys = new Set<string>();
  const totalChats = DIRECT_CHAT_COUNT + GROUP_CHAT_COUNT;
  for (let c = 1; c <= totalChats; c++) {
    const id = seedId('chat', c);
    const direct = c <= DIRECT_CHAT_COUNT;
    let members: number[] = [];
    let directKey: string | null = null;
    if (direct) {
      for (;;) {
        const a = gen.int(1, PERF_USER_COUNT);
        const b = gen.int(1, PERF_USER_COUNT);
        if (a === b) continue;
        const [x, y] = [uid(a), uid(b)];
        const key = x < y ? `${x}:${y}` : `${y}:${x}`;
        if (directKeys.has(key)) continue;
        directKeys.add(key);
        directKey = key;
        members = [a, b];
        break;
      }
    } else {
      const size = gen.int(3, 20);
      const set = new Set<number>();
      while (set.size < size) set.add(gen.int(1, PERF_USER_COUNT));
      members = [...set];
    }

    const createdAt = gen.before(base, 90 * DAY).getTime();
    let at = createdAt;
    const lastAuthoredSeq = new Map<number, number>();
    for (let seq = 1; seq <= MESSAGES_PER_CHAT; seq++) {
      const author = gen.pick(members);
      at += gen.int(1, 240) * MINUTE;
      lastAuthoredSeq.set(author, seq);
      const sentAt = new Date(at);
      messages.push([
        seedId('message', messages.length + 1),
        id,
        uid(author),
        gen.sentence(1, 12),
        'USER',
        seq,
        seq,
        sentAt,
        sentAt,
      ]);
    }
    const lastActivityAt = new Date(at);
    chats.push([
      id,
      direct ? 'DIRECT' : 'GROUP',
      direct ? null : `Perf group ${c - DIRECT_CHAT_COUNT}`,
      directKey,
      uid(members[0]),
      MESSAGES_PER_CHAT,
      lastActivityAt,
      new Date(createdAt),
      lastActivityAt,
    ]);
    members.forEach((m, idx) => {
      const lastRead = Math.max(
        lastAuthoredSeq.get(m) ?? 0,
        gen.int(0, MESSAGES_PER_CHAT),
      );
      participants.push([
        seedId('chat-participant', participants.length + 1),
        id,
        uid(m),
        !direct && idx === 0 ? 'ADMIN' : 'MEMBER',
        new Date(createdAt),
        0,
        lastRead,
        lastActivityAt,
      ]);
    });
    chatIds.push(id);
  }

  const assets: Row[] = images.map((img) => [
    img.id,
    img.url,
    'image/png',
    img.body.length,
    uid(1),
    'PUBLIC',
    img.key.split('/')[1],
    PERF_BASE_DATE,
    PERF_BASE_DATE,
  ]);

  const ts = ['createdAt', 'updatedAt'];
  return {
    chatIds,
    assetIds: images.map((img) => img.id),
    // FK-safe insert order.
    tables: [
      {
        table: 'user_profiles',
        columns: ['id', 'authUserId', 'username', 'displayName', 'bio', ...ts],
        rows: profiles,
      },
      {
        table: 'follows',
        columns: ['id', 'followerId', 'followingId', ...ts],
        rows: follows,
      },
      {
        table: 'assets',
        columns: [
          'id',
          'url',
          'mimeType',
          'size',
          'uploaderId',
          'visibility',
          'originalName',
          ...ts,
        ],
        rows: assets,
      },
      {
        table: 'posts',
        columns: ['id', 'authorId', 'content', 'hashtags', 'status', ...ts],
        rows: posts,
      },
      {
        table: 'post_assets',
        columns: ['id', 'postId', 'assetId', 'displayOrder', 'createdAt'],
        rows: postAssets,
      },
      {
        table: 'comments',
        columns: ['id', 'postId', 'authorId', 'parentId', 'content', ...ts],
        rows: comments,
      },
      {
        table: 'post_likes',
        columns: ['id', 'postId', 'userId', 'createdAt'],
        rows: postLikes,
      },
      {
        table: 'comment_likes',
        columns: ['id', 'commentId', 'userId', 'createdAt'],
        rows: commentLikes,
      },
      {
        table: 'chats',
        columns: [
          'id',
          'type',
          'title',
          'directKey',
          'createdById',
          'lastSeq',
          'lastActivityAt',
          ...ts,
        ],
        rows: chats,
      },
      {
        table: 'chat_participants',
        columns: [
          'id',
          'chatId',
          'userId',
          'role',
          'joinedAt',
          'joinedSeq',
          'lastReadSeq',
          'updatedAt',
        ],
        rows: participants,
      },
      {
        table: 'messages',
        columns: [
          'id',
          'chatId',
          'authorId',
          'content',
          'kind',
          'seq',
          'changeSeq',
          ...ts,
        ],
        rows: messages,
      },
    ],
  };
}

/**
 * Deletes perf-owned rows only: everything authored by perf users (including
 * rows a perf load test created through the API) plus the perf chats and
 * sample assets, children before parents.
 */
async function resetPerf(
  client: Client,
  userIds: string[],
  chatIds: string[],
  assetIds: string[],
): Promise<Record<string, number>> {
  const steps: [string, string, unknown[]][] = [
    ['chats', 'DELETE FROM chats WHERE id = ANY($1::uuid[])', [chatIds]],
    [
      'messages',
      'DELETE FROM messages WHERE "authorId" = ANY($1::uuid[])',
      [userIds],
    ],
    [
      'comment_likes',
      'DELETE FROM comment_likes WHERE "userId" = ANY($1::uuid[])',
      [userIds],
    ],
    [
      'post_likes',
      'DELETE FROM post_likes WHERE "userId" = ANY($1::uuid[])',
      [userIds],
    ],
    ['likes', 'DELETE FROM likes WHERE "userId" = ANY($1::uuid[])', [userIds]],
    [
      'reposts',
      'DELETE FROM reposts WHERE "authorId" = ANY($1::uuid[])',
      [userIds],
    ],
    // Cascades to replies and their likes.
    [
      'comments',
      'DELETE FROM comments WHERE "authorId" = ANY($1::uuid[])',
      [userIds],
    ],
    // Cascades to comments, post_assets and likes on these posts.
    [
      'posts',
      'DELETE FROM posts WHERE "authorId" = ANY($1::uuid[])',
      [userIds],
    ],
    [
      'assets',
      'DELETE FROM assets WHERE id = ANY($1::uuid[]) OR "uploaderId" = ANY($2::uuid[])',
      [assetIds, userIds],
    ],
    [
      'follows',
      'DELETE FROM follows WHERE "followerId" = ANY($1::uuid[]) OR "followingId" = ANY($1::uuid[])',
      [userIds],
    ],
    // Cascades to chat_participants and profile configurations.
    [
      'user_profiles',
      'DELETE FROM user_profiles WHERE "authUserId" = ANY($1::uuid[])',
      [userIds],
    ],
  ];
  const deleted: Record<string, number> = {};
  await client.query('BEGIN');
  try {
    for (const [table, sql, params] of steps) {
      const res = await client.query(sql, params);
      deleted[table] = res.rowCount ?? 0;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
  return deleted;
}

export async function seedPerfProfile(
  client: Client,
  reset: boolean,
): Promise<void> {
  const images = sampleImages();
  const data = generate(images);

  if (reset) {
    const deleted = await resetPerf(
      client,
      perfUserNumbers().map(perfUserId),
      data.chatIds,
      data.assetIds,
    );
    console.log('core perf seed: rows deleted', deleted);
  }

  const uploaded = await uploadSampleImages(images);

  const counts: Record<string, string> = {};
  for (const { table, columns, rows } of data.tables) {
    const inserted = await insertChunked(client, table, columns, rows);
    counts[table] = `${inserted}/${rows.length}`;
  }

  console.log(
    `core perf seed v${PERF_SEED_VERSION}: ${uploaded} sample images uploaded; rows inserted/generated`,
    counts,
  );
}
