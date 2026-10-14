/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest/socket payloads are untyped JSON */
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DomainExceptionFilter } from '@repo/shared';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import {
  ATTACHMENT_STORAGE_PORT,
  type IAttachmentStoragePort,
} from './../src/modules/chats/domain/interfaces/attachment-storage.port';
import { cleanupE2eData } from './helpers/cleanup.helpers';
import {
  EXE_BYTES,
  PDF_BYTES,
  PNG_BYTES,
  TXT_BYTES,
  uniqueBytes,
} from './helpers/attachment.helpers';
import {
  type ConnectResult,
  type Session,
  connectSocket,
  eventsNamed,
  logout,
  registerAndLogin,
  waitFor,
} from './helpers/realtime.helpers';

jest.setTimeout(90000);

interface Uploaded {
  id: string;
  mimeType: string;
  size: number;
  originalName: string;
}

describe('Chat attachments, US5 (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  const sockets: ConnectResult[] = [];

  // a, b: direct chat. c: outsider. d: joins the group late. e: group member.
  let a: Session;
  let b: Session;
  let c: Session;
  let d: Session;
  let e: Session;
  let directId: string;
  const createdChats: string[] = [];

  const authed = (s: Session) => ({ Authorization: `Bearer ${s.accessToken}` });

  const upload = (
    s: Session,
    bytes: Buffer,
    filename: string,
    contentType: string,
  ) =>
    http
      .post('/chats/attachments')
      .set(authed(s))
      .attach('file', bytes, { filename, contentType });

  const uploadOk = async (
    s: Session,
    bytes: Buffer,
    filename: string,
    contentType: string,
  ): Promise<Uploaded> => {
    const res = await upload(s, bytes, filename, contentType).expect(201);
    return res.body;
  };

  const png = (s: Session, tag = randomUUID()) =>
    uploadOk(s, uniqueBytes(PNG_BYTES, tag), `${tag}.png`, 'image/png');

  const sendIn = (
    chatId: string,
    s: Session,
    body: { content?: string; attachmentIds?: string[] },
    clientMessageId = randomUUID(),
  ) =>
    http
      .post(`/chats/${chatId}/messages`)
      .set(authed(s))
      .send({ clientMessageId, ...body });

  const attachmentUrl = (
    s: Session,
    chatId: string,
    messageId: string,
    assetId: string,
  ) =>
    http
      .get(`/chats/${chatId}/messages/${messageId}/attachments/${assetId}`)
      .set(authed(s));

  const download = async (url: string) => {
    const res = await fetch(url);
    return {
      status: res.status,
      headers: res.headers,
      bytes: Buffer.from(await res.arrayBuffer()),
    };
  };

  const track = async (s: Session): Promise<ConnectResult> => {
    const sock = await connectSocket(baseUrl, s.accessToken);
    sockets.push(sock);
    return sock;
  };

  const rows = <T = any>(sql: string, params: unknown[] = []): Promise<T[]> =>
    db.query(sql, params);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace('[::1]', 'localhost');
    http = request(app.getHttpServer());
    db = app.get(DataSource);

    [a, b, c, d, e] = await Promise.all([
      registerAndLogin('att-a'),
      registerAndLogin('att-b'),
      registerAndLogin('att-c'),
      registerAndLogin('att-d'),
      registerAndLogin('att-e'),
    ]);
    // Profiles are created lazily on first use.
    for (const s of [a, b, c, d, e]) {
      await http.get('/profiles/me').set(authed(s)).expect(200);
    }
    const direct = await http
      .post('/chats/direct')
      .set(authed(a))
      .send({ userId: b.userId })
      .expect(201);
    directId = direct.body.id;
    createdChats.push(directId);
  });

  afterAll(async () => {
    sockets.forEach((s) => s.socket.close());
    // Best-effort cleanup of what this suite created: attachments (rows and
    // storage objects), then everything else via cleanupE2eData.
    try {
      const userIds = [a, b, c, d, e].map((s) => s.userId);
      const assets = await rows<{ id: string; storageKey: string | null }>(
        'SELECT id, "storageKey" FROM assets WHERE "uploaderId" = ANY($1)',
        [userIds],
      );
      const keys = assets.flatMap((r) => (r.storageKey ? [r.storageKey] : []));
      if (keys.length > 0) {
        await app
          .get<IAttachmentStoragePort>(ATTACHMENT_STORAGE_PORT)
          .deleteObjects(keys)
          .catch(() => undefined);
      }
      const assetIds = assets.map((r) => r.id);
      await rows(
        'DELETE FROM message_assets WHERE "assetId" = ANY($1) OR "messageId" IN (SELECT id FROM messages WHERE "chatId" = ANY($2))',
        [assetIds, createdChats],
      );
      await rows('DELETE FROM messages WHERE "chatId" = ANY($1)', [
        createdChats,
      ]);
      await rows('DELETE FROM chat_participants WHERE "chatId" = ANY($1)', [
        createdChats,
      ]);
      await rows('DELETE FROM chats WHERE id = ANY($1)', [createdChats]);
      await rows('DELETE FROM assets WHERE id = ANY($1)', [assetIds]);
    } catch {
      /* leftovers are harmless test data */
    }
    await Promise.all([a, b, c, d, e].map((s) => logout(s).catch(() => 0)));
    if (db) await cleanupE2eData(db);
    await app?.close();
  });

  describe('upload validation', () => {
    it('accepts a PNG, a PDF and a .txt', async () => {
      const image = await uploadOk(a, PNG_BYTES, 'pixel.png', 'image/png');
      expect(image).toEqual({
        id: expect.any(String),
        mimeType: 'image/png',
        size: PNG_BYTES.length,
        originalName: 'pixel.png',
      });
      const pdf = await uploadOk(a, PDF_BYTES, 'doc.pdf', 'application/pdf');
      expect(pdf.mimeType).toBe('application/pdf');
      expect(pdf.originalName).toBe('doc.pdf');
      expect(pdf.size).toBe(PDF_BYTES.length);
      const txt = await uploadOk(a, TXT_BYTES, 'notes.txt', 'text/plain');
      expect(txt.mimeType).toBe('text/plain');
      expect(txt.originalName).toBe('notes.txt');
      expect(txt.size).toBe(TXT_BYTES.length);
    });

    it('requires authentication', async () => {
      await http
        .post('/chats/attachments')
        .attach('file', PNG_BYTES, {
          filename: 'pixel.png',
          contentType: 'image/png',
        })
        .expect(401);
    });

    it('rejects a missing file part with 400', async () => {
      await http.post('/chats/attachments').set(authed(a)).expect(400);
    });

    it('rejects an 11 MB file as too large', async () => {
      const big = Buffer.alloc(11 * 1024 * 1024, 'a');
      const res = await upload(a, big, 'big.txt', 'text/plain');
      expect([400, 413]).toContain(res.status);
      expect(JSON.stringify(res.body)).toMatch(/too large|size|exceed/i);
    });

    it('rejects an .exe renamed to .pdf, naming the detected type', async () => {
      const res = await upload(a, EXE_BYTES, 'notes.pdf', 'application/pdf');
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain(
        'File type application/x-msdownload not allowed',
      );
    });

    it('rejects a type outside the allow-list', async () => {
      const res = await upload(
        a,
        Buffer.from('<html></html>'),
        'page.html',
        'text/html',
      );
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain('not allowed');
    });
  });

  describe('sending, ordering and downloading', () => {
    let messageId: string;
    let ordered: Uploaded[];
    const bytesById = new Map<string, Buffer>();

    beforeAll(async () => {
      const files = [
        {
          bytes: uniqueBytes(PNG_BYTES, 'one'),
          name: 'one.png',
          t: 'image/png',
        },
        {
          bytes: uniqueBytes(PDF_BYTES, 'two'),
          name: 'Quarterly report.pdf',
          t: 'application/pdf',
        },
        {
          bytes: uniqueBytes(TXT_BYTES, 'three'),
          name: 'three.txt',
          t: 'text/plain',
        },
      ];
      const uploaded = await Promise.all(
        files.map(async (f) => {
          const u = await uploadOk(a, f.bytes, f.name, f.t);
          bytesById.set(u.id, f.bytes);
          return u;
        }),
      );
      // A request order that differs from the ids' sort order.
      const sorted = [...uploaded].sort((x, y) => x.id.localeCompare(y.id));
      ordered = [sorted[2], sorted[0], sorted[1]];
    });

    it('sends with no text and keeps the request order everywhere', async () => {
      const sockB = await track(b);
      const ids = ordered.map((u) => u.id);
      const res = await sendIn(directId, a, { attachmentIds: ids }).expect(201);
      messageId = res.body.id;

      expect(res.body.content).toBeNull();
      expect(res.body.attachments.map((x: any) => x.id)).toEqual(ids);
      expect(res.body.attachments.map((x: any) => x.displayOrder)).toEqual([
        0, 1, 2,
      ]);
      expect(res.body.attachments.map((x: any) => x.originalName)).toEqual(
        ordered.map((u) => u.originalName),
      );
      for (const att of res.body.attachments) {
        expect(new Date(att.urlExpiresAt).getTime()).toBeGreaterThan(
          Date.now(),
        );
      }

      expect(await waitFor(() => sockB.messages.length === 1)).toBe(true);
      expect(
        sockB.messages[0].message.attachments.map((x: any) => x.id),
      ).toEqual(ids);

      const history = await http
        .get(`/chats/${directId}/messages`)
        .set(authed(b))
        .expect(200);
      const inHistory = history.body.items.find((m: any) => m.id === messageId);
      expect(inHistory.attachments.map((x: any) => x.id)).toEqual(ids);

      const changes = await http
        .get(`/chats/${directId}/messages/changes`)
        .query({ afterChangeSeq: 0 })
        .set(authed(b))
        .expect(200);
      const inChanges = changes.body.items.find((m: any) => m.id === messageId);
      expect(inChanges.attachments.map((x: any) => x.id)).toEqual(ids);
    });

    it('serves the bytes through the response URLs, with download disposition for files', async () => {
      const res = await http
        .get(`/chats/${directId}/messages`)
        .set(authed(b))
        .expect(200);
      const message = res.body.items.find((m: any) => m.id === messageId);
      for (const att of message.attachments) {
        const got = await download(att.url);
        expect(got.status).toBe(200);
        expect(got.bytes.equals(bytesById.get(att.id)!)).toBe(true);
        const disposition = got.headers.get('content-disposition') ?? '';
        if (att.kind === 'file') {
          expect(disposition).toMatch(/^attachment/);
          expect(disposition).toContain(att.originalName.replace(/ /g, '%20'));
        } else {
          expect(disposition).not.toMatch(/^attachment/);
        }
      }
      expect(message.attachments.map((x: any) => x.kind)).toEqual(
        ordered.map((u) =>
          u.mimeType.startsWith('image/') ? 'image' : 'file',
        ),
      );
    });

    it('gives a participant a URL that downloads the bytes', async () => {
      for (const who of [a, b]) {
        for (const u of ordered) {
          const res = await attachmentUrl(
            who,
            directId,
            messageId,
            u.id,
          ).expect(200);
          expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(
            Date.now(),
          );
          const got = await download(res.body.url);
          expect(got.status).toBe(200);
          expect(got.bytes.equals(bytesById.get(u.id)!)).toBe(true);
          if (!u.mimeType.startsWith('image/')) {
            expect(got.headers.get('content-disposition')).toMatch(
              /^attachment/,
            );
          }
        }
      }
    });

    it('refuses the raw object URL without a signature', async () => {
      const res = await attachmentUrl(b, directId, messageId, ordered[0].id);
      const bare = res.body.url.split('?')[0];
      const got = await download(bare);
      expect(got.status).toBe(403);
    });

    it('hides the attachment from an outsider and for unknown ids (404)', async () => {
      await attachmentUrl(c, directId, messageId, ordered[0].id).expect(404);
      await attachmentUrl(b, directId, messageId, randomUUID()).expect(404);
      await attachmentUrl(b, directId, randomUUID(), ordered[0].id).expect(404);
      await attachmentUrl(b, randomUUID(), messageId, ordered[0].id).expect(
        404,
      );
    });

    it('does not resolve a message id through another chat', async () => {
      // The outsider has a chat of their own; the message id must not resolve there.
      const own = await http
        .post('/chats/direct')
        .set(authed(c))
        .send({ userId: d.userId })
        .expect(201);
      createdChats.push(own.body.id);
      await attachmentUrl(c, own.body.id, messageId, ordered[0].id).expect(404);
    });

    it('rejects a send with neither text nor attachments', async () => {
      await sendIn(directId, a, {}).expect(400);
      await sendIn(directId, a, { content: '   ' }).expect(400);
    });
  });

  describe('attachment eligibility', () => {
    it("rejects someone else's asset, an unknown id, a reuse and a duplicate with 400", async () => {
      const foreign = await png(c);
      await sendIn(directId, a, { attachmentIds: [foreign.id] }).expect(400);
      await sendIn(directId, a, { attachmentIds: [randomUUID()] }).expect(400);

      const mine = await png(a);
      const first = await sendIn(directId, a, {
        attachmentIds: [mine.id],
      }).expect(201);
      const reuse = await sendIn(directId, a, {
        attachmentIds: [mine.id],
      }).expect(400);
      expect(JSON.stringify(reuse.body.message)).toMatch(/already attached/);
      // The first message is untouched.
      expect(first.body.attachments).toHaveLength(1);

      const twice = await png(a);
      await sendIn(directId, a, {
        attachmentIds: [twice.id, twice.id],
      }).expect(400);
      // Nothing was attached by the failed requests.
      const linked = await rows(
        'SELECT 1 FROM message_assets WHERE "assetId" = $1',
        [twice.id],
      );
      expect(linked).toHaveLength(0);
    });
  });

  describe('edit', () => {
    it('allows an empty text only when attachments exist, and returns them', async () => {
      const sockA = await track(a);
      const sockB = await track(b);

      const att = await png(a);
      const withFile = await sendIn(directId, a, {
        content: 'caption',
        attachmentIds: [att.id],
      }).expect(201);
      const textOnly = await sendIn(directId, a, {
        content: 'just text',
      }).expect(201);

      const edited = await http
        .patch(`/chats/${directId}/messages/${withFile.body.id}`)
        .set(authed(a))
        .send({ content: '' })
        .expect(200);
      expect(edited.body.content).toBeNull();
      expect(edited.body.editedAt).not.toBeNull();
      expect(edited.body.changeSeq).toBeGreaterThan(withFile.body.changeSeq);
      expect(edited.body.attachments.map((x: any) => x.id)).toEqual([att.id]);
      const got = await download(edited.body.attachments[0].url);
      expect(got.status).toBe(200);

      expect(
        await waitFor(
          () =>
            eventsNamed(sockB, 'message:updated').some(
              (p) => p.message.id === withFile.body.id,
            ) &&
            eventsNamed(sockA, 'message:updated').some(
              (p) => p.message.id === withFile.body.id,
            ),
        ),
      ).toBe(true);
      const event = eventsNamed(sockB, 'message:updated').find(
        (p) => p.message.id === withFile.body.id,
      );
      expect(event.message.attachments.map((x: any) => x.id)).toEqual([att.id]);
      expect(event.message.content).toBeNull();
      expect(event.message.changeSeq).toBe(edited.body.changeSeq);

      const rejected = await http
        .patch(`/chats/${directId}/messages/${textOnly.body.id}`)
        .set(authed(a))
        .send({ content: '' })
        .expect(400);
      expect(rejected.body.error).toBe('EmptyMessageError');
    });
  });

  describe('delete', () => {
    it('leaves a tombstone, frees the asset rows and removes the objects', async () => {
      const sockB = await track(b);
      const files = await Promise.all([png(a), png(a)]);
      const ids = [files[1].id, files[0].id];
      const sent = await sendIn(directId, a, {
        content: 'to be removed',
        attachmentIds: ids,
      }).expect(201);
      const messageId = sent.body.id;
      const oldUrls: string[] = sent.body.attachments.map((x: any) => x.url);
      expect((await download(oldUrls[0])).status).toBe(200);

      const before = await rows(
        'SELECT "changeSeq" FROM messages WHERE id = $1',
        [messageId],
      );
      expect(
        await rows('SELECT 1 FROM message_assets WHERE "messageId" = $1', [
          messageId,
        ]),
      ).toHaveLength(2);

      await http
        .delete(`/chats/${directId}/messages/${messageId}`)
        .set(authed(a))
        .expect(204);

      // Tombstone columns and a fresh changeSeq.
      const [row] = await rows(
        'SELECT content, "deletedAt", "changeSeq" FROM messages WHERE id = $1',
        [messageId],
      );
      expect(row.content).toBeNull();
      expect(row.deletedAt).not.toBeNull();
      expect(Number(row.changeSeq)).toBeGreaterThan(
        Number(before[0].changeSeq),
      );
      // message_assets rows gone, assets soft-deleted.
      expect(
        await rows('SELECT 1 FROM message_assets WHERE "messageId" = $1', [
          messageId,
        ]),
      ).toHaveLength(0);
      const assets = await rows(
        'SELECT id, "deletedAt" FROM assets WHERE id = ANY($1)',
        [ids],
      );
      expect(assets).toHaveLength(2);
      assets.forEach((r: any) => expect(r.deletedAt).not.toBeNull());

      // The old object is gone from storage.
      for (const url of oldUrls) {
        expect((await download(url)).status).toBe(404);
      }

      // The attachment endpoint no longer resolves, for either participant.
      for (const id of ids) {
        await attachmentUrl(a, directId, messageId, id).expect(404);
        await attachmentUrl(b, directId, messageId, id).expect(404);
      }

      // Realtime and catch-up show the tombstone.
      expect(
        await waitFor(() =>
          eventsNamed(sockB, 'message:deleted').some(
            (p) => p.messageId === messageId,
          ),
        ),
      ).toBe(true);
      const changes = await http
        .get(`/chats/${directId}/messages/changes`)
        .query({ afterChangeSeq: Number(before[0].changeSeq) })
        .set(authed(b))
        .expect(200);
      const tombstone = changes.body.items.find((m: any) => m.id === messageId);
      expect(tombstone).toMatchObject({
        content: null,
        attachments: [],
        changeSeq: Number(row.changeSeq),
      });
      expect(tombstone.deletedAt).not.toBeNull();
      const history = await http
        .get(`/chats/${directId}/messages`)
        .set(authed(b))
        .expect(200);
      const inHistory = history.body.items.find((m: any) => m.id === messageId);
      expect(inHistory.attachments).toEqual([]);
      expect(inHistory.deletedAt).not.toBeNull();

      // findVisibleById still returns the soft-deleted row: the domain rule
      // (400), not a missing message (404), answers a further edit or delete.
      const edit = await http
        .patch(`/chats/${directId}/messages/${messageId}`)
        .set(authed(a))
        .send({ content: 'zombie' })
        .expect(400);
      expect(edit.body.error).toBe('MessageAlreadyDeletedError');
      await http
        .delete(`/chats/${directId}/messages/${messageId}`)
        .set(authed(a))
        .expect(400);
    });

    it('does not allow reusing the files of a deleted message', async () => {
      const file = await png(a);
      const sent = await sendIn(directId, a, {
        attachmentIds: [file.id],
      }).expect(201);
      await http
        .delete(`/chats/${directId}/messages/${sent.body.id}`)
        .set(authed(a))
        .expect(204);
      // The asset is soft-deleted, so it is "not found" now.
      await sendIn(directId, a, { attachmentIds: [file.id] }).expect(400);
    });
  });

  describe('group visibility', () => {
    it('does not hand a late joiner the attachments of earlier messages', async () => {
      const group = await http
        .post('/chats/groups')
        .set(authed(a))
        .send({ title: 'attachments', memberIds: [b.userId, e.userId] })
        .expect(201);
      const gid: string = group.body.id;
      createdChats.push(gid);

      const file = await png(a);
      const early = await sendIn(gid, a, { attachmentIds: [file.id] }).expect(
        201,
      );
      await attachmentUrl(b, gid, early.body.id, file.id).expect(200);

      await http
        .post(`/chats/${gid}/members`)
        .set(authed(a))
        .send({ userIds: [d.userId] })
        .expect(200);

      await attachmentUrl(d, gid, early.body.id, file.id).expect(404);
      // Existing members and the author keep access.
      await attachmentUrl(e, gid, early.body.id, file.id).expect(200);
      await attachmentUrl(a, gid, early.body.id, file.id).expect(200);

      // A message sent after the join is reachable.
      const late = await png(a);
      const after = await sendIn(gid, a, { attachmentIds: [late.id] }).expect(
        201,
      );
      const ok = await attachmentUrl(d, gid, after.body.id, late.id).expect(
        200,
      );
      expect((await download(ok.body.url)).status).toBe(200);
      // And the early message is not in the late joiner's history either.
      const history = await http
        .get(`/chats/${gid}/messages`)
        .set(authed(d))
        .expect(200);
      expect(history.body.items.some((m: any) => m.id === early.body.id)).toBe(
        false,
      );
    });
  });
});
