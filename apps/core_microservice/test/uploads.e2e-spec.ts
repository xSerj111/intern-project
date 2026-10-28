/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest payloads are untyped JSON */
import { randomBytes, randomUUID } from 'node:crypto';
import { UPLOAD_MAX_BYTES } from '@repo/contracts';
import * as jwt from 'jsonwebtoken';
import { AssetRepository } from '../src/modules/assets/infrastructure/repository/asset.repository';
import { PendingUploadSweeper } from '../src/modules/assets/infrastructure/pending-upload.sweeper';
import {
  FileStoragePortKey,
  type IFileStoragePort,
} from '../src/modules/assets/domain/interfaces/file-storage.port';
import {
  UPLOAD_REPOSITORY,
  type IUploadRepository,
} from '../src/modules/assets/domain/interfaces/upload-repository.port';
import {
  ATTACHMENT_STORAGE_PORT,
  type IAttachmentStoragePort,
} from '../src/modules/chats/domain/interfaces/attachment-storage.port';
import { bearer } from './helpers/api.helpers';
import { createE2eApp, type E2eApp } from './helpers/app.helpers';
import {
  EXE_BYTES,
  PNG_BYTES,
  TXT_BYTES,
  postToStorage,
  presignedUpload,
  requestUploadTicket,
} from './helpers/attachment.helpers';
import { cleanupE2eData } from './helpers/cleanup.helpers';
import type { Session } from './helpers/realtime.helpers';

jest.setTimeout(120000);

/** Short signed-link lifetime, so the "expired link" row can really expire. */
const LINK_TTL_SEC = 3;

interface AssetRow {
  id: string;
  status: string;
  bucket: string | null;
  storageKey: string | null;
  deletedAt: Date | null;
}

/**
 * Signed direct-to-storage uploads against Postgres and local SeaweedFS
 * (quickstart §6, contracts/uploads-http.md). Own file because createE2eApp
 * applies one env set per Jest worker. Tokens are minted locally, so the auth
 * service is not needed.
 */
describe('Uploads, US6 (e2e)', () => {
  let e2e: E2eApp;
  let http: E2eApp['http'];
  let storage: IFileStoragePort;
  let uploads: IUploadRepository;
  let assetRepo: AssetRepository;
  let attachments: IAttachmentStoragePort;
  let sweeper: PendingUploadSweeper;
  let secret: string;
  let privateBucket: string;
  let a: Session;
  let b: Session;
  const userIds: string[] = [];

  const newUser = async (): Promise<Session> => {
    const userId = randomUUID();
    userIds.push(userId);
    const session: Session = {
      email: `${userId}@test.local`,
      userId,
      accessToken: jwt.sign(
        { sub: userId, email: `${userId}@test.local`, jti: randomUUID() },
        secret,
        { algorithm: 'HS256', expiresIn: '30m' },
      ),
      refreshToken: '',
    };
    await http.get('/profiles/me').set(bearer(session)).expect(200);
    return session;
  };

  const confirm = (s: Session, uploadId: string) =>
    http.post(`/uploads/${uploadId}/confirm`).set(bearer(s));

  /** The row as stored, soft-deleted or not. */
  const assetRow = async (id: string): Promise<AssetRow | undefined> => {
    const [row] = await e2e.db.query<AssetRow[]>(
      'SELECT id, status, bucket, "storageKey", "deletedAt" FROM assets WHERE id = $1',
      [id],
    );
    return row;
  };

  const readyCount = async (id: string): Promise<number> => {
    const [row] = await e2e.db.query<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM assets
        WHERE id = $1 AND status = 'READY' AND "deletedAt" IS NULL`,
      [id],
    );
    return row.n;
  };

  /** Moves a PENDING row's link expiry into the past (beyond confirm and sweep grace). */
  const expire = (ids: string[]) =>
    e2e.db.query(
      `UPDATE assets SET "expiresAt" = now() - interval '1 hour' WHERE id = ANY($1::uuid[])`,
      [ids],
    );

  const pngOf = (bytes: number) =>
    Buffer.concat([PNG_BYTES, randomBytes(bytes - PNG_BYTES.length)]);

  beforeAll(async () => {
    e2e = await createE2eApp({
      UPLOAD_LINK_TTL_SEC: String(LINK_TTL_SEC),
      // The smallest grace the config accepts; rows are expired by SQL anyway.
      UPLOAD_SWEEP_GRACE_SEC: '1',
      // Ticks are driven by the tests, never by the timer.
      UPLOAD_SWEEP_INTERVAL_SEC: '3600',
    });
    http = e2e.http;
    storage = e2e.app.get<IFileStoragePort>(FileStoragePortKey);
    uploads = e2e.app.get<IUploadRepository>(UPLOAD_REPOSITORY);
    assetRepo = e2e.app.get(AssetRepository);
    attachments = e2e.app.get<IAttachmentStoragePort>(ATTACHMENT_STORAGE_PORT);
    sweeper = e2e.app.get(PendingUploadSweeper);
    secret = (process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET)!;
    privateBucket = process.env.S3_PRIVATE_BUCKET_NAME || 'innogram-private';
    [a, b] = [await newUser(), await newUser()];
  });

  afterAll(async () => {
    try {
      const rows = await e2e.db.query<AssetRow[]>(
        'SELECT id, status, bucket, "storageKey", "deletedAt" FROM assets WHERE "uploaderId" = ANY($1::uuid[])',
        [userIds],
      );
      for (const row of rows) {
        if (row.bucket && row.storageKey) {
          await storage
            .deleteObject(row.bucket, row.storageKey)
            .catch(() => undefined);
        }
      }
      await e2e.db.query(
        'DELETE FROM posts WHERE "authorId" = ANY($1::uuid[])',
        [userIds],
      );
    } catch {
      /* leftovers are harmless test data */
    }
    await cleanupE2eData(e2e.db, userIds);
    await e2e.close();
  });

  describe('POST /uploads', () => {
    it('issues a ticket for the signed policy', async () => {
      const ticket = await requestUploadTicket(http, a, {
        purpose: 'post-image',
        contentType: 'image/png',
        size: 1234,
      });
      expect(ticket).toEqual({
        uploadId: expect.any(String),
        url: expect.stringContaining(`/${privateBucket}`),
        fields: expect.objectContaining({
          key: `pending/${a.userId}/${ticket.uploadId}`,
          'Content-Type': 'image/png',
        }),
        maxBytes: UPLOAD_MAX_BYTES,
        expiresAt: expect.any(String),
      });
      const ttlMs = new Date(ticket.expiresAt).getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan(0);
      expect(ttlMs).toBeLessThanOrEqual(LINK_TTL_SEC * 1000);
      expect((await assetRow(ticket.uploadId))?.status).toBe('PENDING');
    });

    it('rejects an invalid body with 400 and no token with 401', async () => {
      const bad = [
        { purpose: 'banner', contentType: 'image/png', size: 10 },
        { purpose: 'post-image', contentType: 'image/png', size: 0 },
        {
          purpose: 'post-image',
          contentType: 'image/png',
          size: UPLOAD_MAX_BYTES + 1,
        },
        { purpose: 'post-image', contentType: 'image/svg+xml', size: 10 },
        { purpose: 'avatar', contentType: 'application/pdf', size: 10 },
      ];
      for (const body of bad) {
        await http.post('/uploads').set(bearer(a)).send(body).expect(400);
      }
      await http
        .post('/uploads')
        .send({ purpose: 'post-image', contentType: 'image/png', size: 10 })
        .expect(401);
    });
  });

  describe('quickstart §6', () => {
    it('PNG 200 KB → confirm → POST /posts shows the public-bucket URL', async () => {
      const bytes = pngOf(200 * 1024);
      const asset = await presignedUpload(
        http,
        a,
        'post-image',
        bytes,
        'image/png',
      );
      expect(asset).toMatchObject({
        id: expect.any(String),
        mimeType: 'image/png',
        size: bytes.length,
      });
      expect(asset.url).toMatch(new RegExp(`/${asset.id}\\.png$`));
      expect(asset.url).not.toContain(privateBucket);

      // Promoted: the public object serves the bytes, the pending copy is gone.
      const got = await fetch(asset.url!);
      expect(got.status).toBe(200);
      expect(Buffer.from(await got.arrayBuffer()).equals(bytes)).toBe(true);
      expect(
        await storage.head(privateBucket, `pending/${a.userId}/${asset.id}`),
      ).toBeNull();
      expect(await assetRow(asset.id)).toMatchObject({
        status: 'READY',
        storageKey: `${asset.id}.png`,
      });

      const post = await http
        .post('/posts')
        .set(bearer(a))
        .send({ content: 'with image', assetIds: [asset.id] })
        .expect(201);
      expect(post.body.assets).toEqual([
        expect.objectContaining({
          assetId: asset.id,
          url: asset.url,
          mimeType: 'image/png',
        }),
      ]);
    });

    it('.exe bytes declared image/png → 400 UploadContentRejectedError, object gone, no READY asset', async () => {
      const ticket = await requestUploadTicket(http, a, {
        purpose: 'post-image',
        contentType: 'image/png',
        size: EXE_BYTES.length,
      });
      const stored = await postToStorage(ticket, EXE_BYTES);
      expect(stored.status).toBe(204);
      const key = ticket.fields.key;
      expect(await storage.head(privateBucket, key)).not.toBeNull();

      const res = await confirm(a, ticket.uploadId).expect(400);
      expect(res.body.error).toBe('UploadContentRejectedError');
      expect(JSON.stringify(res.body.message)).toContain(
        'File content is not an allowed type',
      );

      expect(await storage.head(privateBucket, key)).toBeNull();
      expect(await readyCount(ticket.uploadId)).toBe(0);
      expect((await assetRow(ticket.uploadId))?.deletedAt).not.toBeNull();
    });

    it('11 MiB → storage 400 EntityTooLarge, confirm 400 UploadNotReadyError, no asset', async () => {
      const ticket = await requestUploadTicket(http, a, {
        purpose: 'chat-attachment',
        contentType: 'text/plain',
        size: UPLOAD_MAX_BYTES,
        fileName: 'big.txt',
      });
      const stored = await postToStorage(
        ticket,
        Buffer.alloc(11 * 1024 * 1024, 'a'),
      );
      expect(stored.status).toBe(400);
      expect(stored.body).toContain('EntityTooLarge');
      expect(await storage.head(privateBucket, ticket.fields.key)).toBeNull();

      const res = await confirm(a, ticket.uploadId).expect(400);
      expect(res.body.error).toBe('UploadNotReadyError');
      expect(await readyCount(ticket.uploadId)).toBe(0);
    });

    it('confirm by another user or of an unknown id → 404', async () => {
      const ticket = await requestUploadTicket(http, a, {
        purpose: 'post-image',
        contentType: 'image/png',
        size: PNG_BYTES.length,
      });
      expect((await postToStorage(ticket, PNG_BYTES)).status).toBe(204);

      await confirm(b, ticket.uploadId).expect(404);
      await confirm(a, randomUUID()).expect(404);
      // The owner can still confirm afterwards.
      await confirm(a, ticket.uploadId).expect(200);
    });

    it('signed fields with a different key → storage 403', async () => {
      const ticket = await requestUploadTicket(http, a, {
        purpose: 'post-image',
        contentType: 'image/png',
        size: PNG_BYTES.length,
      });
      const otherKey = `pending/${b.userId}/${randomUUID()}`;
      const stored = await postToStorage(ticket, PNG_BYTES, { key: otherKey });
      expect(stored.status).toBe(403);
      expect(await storage.head(privateBucket, otherKey)).toBeNull();
      expect(await storage.head(privateBucket, ticket.fields.key)).toBeNull();
    });

    it('expired link → storage 403, confirm 400 UploadExpiredError', async () => {
      const ticket = await requestUploadTicket(http, a, {
        purpose: 'post-image',
        contentType: 'image/png',
        size: PNG_BYTES.length,
      });
      await new Promise((r) => setTimeout(r, (LINK_TTL_SEC + 2) * 1000));
      const stored = await postToStorage(ticket, PNG_BYTES);
      expect(stored.status).toBe(403);
      expect(await storage.head(privateBucket, ticket.fields.key)).toBeNull();

      // Confirm allows 60 s of clock skew past expiresAt; move it further back.
      await expire([ticket.uploadId]);
      const res = await confirm(a, ticket.uploadId).expect(400);
      expect(res.body.error).toBe('UploadExpiredError');
    });

    it('confirm twice → the same body, one asset', async () => {
      const before = await e2e.db.query<Array<{ n: number }>>(
        'SELECT count(*)::int AS n FROM assets WHERE "uploaderId" = $1',
        [b.userId],
      );
      const ticket = await requestUploadTicket(http, b, {
        purpose: 'chat-attachment',
        contentType: 'text/plain',
        size: TXT_BYTES.length,
        fileName: 'notes.txt',
      });
      expect((await postToStorage(ticket, TXT_BYTES)).status).toBe(204);

      const first = await confirm(b, ticket.uploadId).expect(200);
      const second = await confirm(b, ticket.uploadId).expect(200);
      expect(first.body).toEqual({
        id: ticket.uploadId,
        mimeType: 'text/plain',
        size: TXT_BYTES.length,
        originalName: 'notes.txt',
      });
      expect(second.body).toEqual(first.body);

      const after = await e2e.db.query<Array<{ n: number }>>(
        'SELECT count(*)::int AS n FROM assets WHERE "uploaderId" = $1',
        [b.userId],
      );
      expect(after[0].n).toBe(before[0].n + 1);
      expect(await readyCount(ticket.uploadId)).toBe(1);
    });

    it('never confirmed + sweeper.tick() → row and object removed; never visible before', async () => {
      const chat = await http
        .post('/chats/direct')
        .set(bearer(a))
        .send({ userId: b.userId })
        .expect(201);
      const image = await requestUploadTicket(http, a, {
        purpose: 'post-image',
        contentType: 'image/png',
        size: PNG_BYTES.length,
      });
      const file = await requestUploadTicket(http, a, {
        purpose: 'chat-attachment',
        contentType: 'text/plain',
        size: TXT_BYTES.length,
        fileName: 'left.txt',
      });
      expect((await postToStorage(image, PNG_BYTES)).status).toBe(204);
      expect((await postToStorage(file, TXT_BYTES)).status).toBe(204);
      const ids = [image.uploadId, file.uploadId];

      // PENDING rows are invisible to every read path.
      expect(await assetRepo.findByIds(ids)).toEqual([]);
      await expect(
        assetRepo.findOneByIdOrThrow(image.uploadId),
      ).rejects.toThrow();
      expect(await attachments.findAssets(ids)).toEqual([]);
      await http
        .post('/posts')
        .set(bearer(a))
        .send({ content: 'pending', assetIds: [image.uploadId] })
        .expect(404);
      await http
        .post(`/chats/${chat.body.id}/messages`)
        .set(bearer(a))
        .send({ clientMessageId: randomUUID(), attachmentIds: [file.uploadId] })
        .expect(400);

      await expire(ids);
      await sweeper.tick();

      for (const [ticket, id] of [
        [image, image.uploadId],
        [file, file.uploadId],
      ] as const) {
        expect(await assetRow(id)).toBeUndefined();
        expect(await storage.head(privateBucket, ticket.fields.key)).toBeNull();
      }
      await confirm(a, image.uploadId).expect(404);
    });

    it("POST /posts with another user's READY asset or a PENDING asset → 404, a chat attachment → 400", async () => {
      const foreign = await presignedUpload(
        http,
        b,
        'post-image',
        PNG_BYTES,
        'image/png',
      );
      await http
        .post('/posts')
        .set(bearer(a))
        .send({ content: 'foreign', assetIds: [foreign.id] })
        .expect(404);

      const pending = await requestUploadTicket(http, a, {
        purpose: 'post-image',
        contentType: 'image/png',
        size: PNG_BYTES.length,
      });
      await http
        .post('/posts')
        .set(bearer(a))
        .send({ content: 'pending', assetIds: [pending.uploadId] })
        .expect(404);

      const chatFile = await presignedUpload(
        http,
        a,
        'chat-attachment',
        TXT_BYTES,
        'text/plain',
        'x.txt',
      );
      const res = await http
        .post('/posts')
        .set(bearer(a))
        .send({ content: 'wrong purpose', assetIds: [chatFile.id] })
        .expect(400);
      expect(res.body.error).toBe('AssetNotAttachableError');
    });

    it('removed endpoints POST /assets/upload and POST /chats/attachments → 404', async () => {
      for (const path of ['/assets/upload', '/chats/attachments']) {
        await http
          .post(path)
          .set(bearer(a))
          .attach('file', PNG_BYTES, {
            filename: 'pixel.png',
            contentType: 'image/png',
          })
          .expect(404);
      }
    });
  });

  describe('UploadRepository.claimSweepable (Postgres)', () => {
    /** PENDING rows of `a` whose link expired an hour ago. */
    const expiredPending = async (n: number): Promise<string[]> => {
      const ids: string[] = [];
      for (let i = 0; i < n; i++) {
        const t = await requestUploadTicket(http, a, {
          purpose: 'post-image',
          contentType: 'image/png',
          size: 10,
        });
        ids.push(t.uploadId);
      }
      await expire(ids);
      return ids;
    };

    const mine = (rows: Array<{ id: string }>, ids: string[]) =>
      rows.map((r) => r.id).filter((id) => ids.includes(id));

    it('claims only expired PENDING rows past the grace', async () => {
      const [expired] = await expiredPending(1);
      const fresh = await requestUploadTicket(http, a, {
        purpose: 'post-image',
        contentType: 'image/png',
        size: 10,
      });
      const ready = await presignedUpload(
        http,
        a,
        'post-image',
        PNG_BYTES,
        'image/png',
      );
      const claimed = await uploads.claimSweepable(500, 1);
      expect(claimed.every((r) => r.status === 'PENDING')).toBe(true);
      expect(mine(claimed, [expired, fresh.uploadId, ready.id])).toEqual([
        expired,
      ]);
      await uploads.hardDelete([expired]);
    });

    it('skips rows another claimer holds (disjoint claims, no blocking)', async () => {
      const ids = await expiredPending(3);
      const qr = e2e.db.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      try {
        // A second sweeper mid-claim: same predicate, FOR UPDATE SKIP LOCKED.
        const locked: Array<{ id: string }> = await qr.query(
          `SELECT id FROM assets
            WHERE status = 'PENDING' AND id = ANY($1::uuid[])
            ORDER BY "expiresAt", id LIMIT 2
            FOR UPDATE SKIP LOCKED`,
          [ids],
        );
        const held = locked.map((r) => r.id);
        expect(held).toHaveLength(2);

        const started = Date.now();
        const [first, second] = await Promise.all([
          uploads.claimSweepable(500, 1),
          uploads.claimSweepable(500, 1),
        ]);
        expect(Date.now() - started).toBeLessThan(5000);
        const rest = ids.filter((id) => !held.includes(id));
        // Neither concurrent claim sees the held rows. When the two claims
        // overlap, SKIP LOCKED hands the free row to only one of them.
        for (const claim of [first, second]) {
          expect(mine(claim, held)).toEqual([]);
        }
        expect(
          [...new Set([...mine(first, ids), ...mine(second, ids)])].sort(),
        ).toEqual([...rest].sort());

        // With every row held, a claim returns none of them, without waiting.
        await qr.query(
          'SELECT id FROM assets WHERE id = ANY($1::uuid[]) FOR UPDATE',
          [rest],
        );
        const none = await uploads.claimSweepable(500, 1);
        expect(mine(none, ids)).toEqual([]);
      } finally {
        await qr.rollbackTransaction();
        await qr.release();
      }
      // Released: the rows are claimable again.
      expect(mine(await uploads.claimSweepable(500, 1), ids).sort()).toEqual(
        [...ids].sort(),
      );
      await uploads.hardDelete(ids);
    });
  });
});
