import { Message, type AttachmentCandidate } from './message.entity';
import {
  EmptyMessageError,
  InvalidAttachmentError,
  MessageAlreadyDeletedError,
  MessageTooLongError,
  NotMessageAuthorError,
  SystemMessageImmutableError,
  TooManyAttachmentsError,
} from '../errors/chat.errors';

const base = {
  chatId: 'chat-1',
  authorId: 'user-1',
  clientMessageId: 'client-1',
  seq: 5,
};

const candidate = (
  assetId: string,
  overrides: Partial<AttachmentCandidate> = {},
): AttachmentCandidate => ({
  assetId,
  found: true,
  uploaderId: 'user-1',
  visibility: 'PRIVATE',
  alreadyAttached: false,
  ...overrides,
});

const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => candidate(`asset-${i}`));

describe('Message.create', () => {
  it('trims content and defaults kind to USER', () => {
    const m = Message.create({ ...base, content: '  hello  ' });
    expect(m.content).toBe('hello');
    expect(m.kind).toBe('USER');
  });

  it('sets changeSeq equal to seq', () => {
    const m = Message.create({ ...base, content: 'hi' });
    expect(m.seq).toBe(5);
    expect(m.changeSeq).toBe(m.seq);
  });

  it('rejects whitespace-only content without attachments', () => {
    expect(() => Message.create({ ...base, content: '   ' })).toThrow(
      EmptyMessageError,
    );
    expect(() => Message.create({ ...base })).toThrow(EmptyMessageError);
  });

  it('rejects 2,001 chars and accepts 2,000', () => {
    expect(() =>
      Message.create({ ...base, content: 'a'.repeat(2001) }),
    ).toThrow(MessageTooLongError);
    expect(
      Message.create({ ...base, content: 'a'.repeat(2000) }).content,
    ).toHaveLength(2000);
  });

  it('rejects 11 attachments and accepts 10', () => {
    expect(() => Message.create({ ...base, attachments: ids(11) })).toThrow(
      TooManyAttachmentsError,
    );
    expect(() =>
      Message.create({ ...base, attachments: ids(10) }),
    ).not.toThrow();
  });

  it('accepts attachments only, storing null content', () => {
    const m = Message.create({ ...base, content: '  ', attachments: ids(1) });
    expect(m.content).toBeNull();
  });

  it('keeps attachment ids in request order', () => {
    const m = Message.create({
      ...base,
      attachments: [candidate('b'), candidate('a'), candidate('c')],
    });
    expect(m.attachmentIds).toEqual(['b', 'a', 'c']);
  });

  it.each<[string, Partial<AttachmentCandidate>]>([
    ['missing', { found: false, uploaderId: null, visibility: null }],
    ["not the author's", { uploaderId: 'user-2' }],
    ['not PRIVATE', { visibility: 'PUBLIC' }],
    ['already attached', { alreadyAttached: true }],
  ])('rejects an attachment that is %s', (_label, overrides) => {
    expect(() =>
      Message.create({
        ...base,
        content: 'hi',
        attachments: [candidate('ok'), candidate('bad', overrides)],
      }),
    ).toThrow(InvalidAttachmentError);
  });

  it('rejects the same attachment twice', () => {
    expect(() =>
      Message.create({
        ...base,
        attachments: [candidate('a'), candidate('a')],
      }),
    ).toThrow(InvalidAttachmentError);
  });
});

describe('Message.isVisibleTo', () => {
  const m = Message.create({ ...base, content: 'hi' });

  it('is visible when active and seq > joinedSeq', () => {
    expect(m.isVisibleTo({ leftAt: null, joinedSeq: 4 })).toBe(true);
  });

  it('is hidden when seq <= joinedSeq', () => {
    expect(m.isVisibleTo({ leftAt: null, joinedSeq: 5 })).toBe(false);
    expect(m.isVisibleTo({ leftAt: null, joinedSeq: 9 })).toBe(false);
  });

  it('is hidden once the participant has left', () => {
    expect(m.isVisibleTo({ leftAt: new Date(), joinedSeq: 0 })).toBe(false);
  });
});

describe('Message.attachmentFor', () => {
  const file = {
    assetId: 'asset-0',
    displayOrder: 0,
    storageKey: 'chat/user-1/k',
    mimeType: 'image/png',
    size: 10,
    originalName: 'a.png',
  };
  const make = () => {
    const m = Message.create({ ...base, attachments: ids(1) });
    m.attachments = [file];
    return m;
  };
  const viewer = { leftAt: null, joinedSeq: 0 };

  it('returns the attachment for a visible message', () => {
    expect(make().attachmentFor(viewer, 'asset-0')).toBe(file);
  });

  it('returns null for an asset not on the message', () => {
    expect(make().attachmentFor(viewer, 'asset-9')).toBeNull();
  });

  it('returns null when the message is not visible to the viewer', () => {
    expect(
      make().attachmentFor({ leftAt: null, joinedSeq: 5 }, 'asset-0'),
    ).toBeNull();
    expect(
      make().attachmentFor({ leftAt: new Date(), joinedSeq: 0 }, 'asset-0'),
    ).toBeNull();
  });

  it('returns null once the message is deleted', () => {
    const m = make();
    m.delete('user-1', 9);
    expect(m.attachmentFor(viewer, 'asset-0')).toBeNull();
  });
});

describe('Message.edit', () => {
  const make = (attachments = 0) =>
    Message.create({
      ...base,
      content: 'hi',
      attachments: ids(attachments),
    });

  it('sets content, editedAt and the new changeSeq', () => {
    const m = make();
    m.edit('user-1', '  updated  ', 9);
    expect(m.content).toBe('updated');
    expect(m.editedAt).toBeInstanceOf(Date);
    expect(m.changeSeq).toBe(9);
    expect(m.seq).toBe(5);
  });

  it('rejects a non-author', () => {
    expect(() => make().edit('user-2', 'x', 9)).toThrow(NotMessageAuthorError);
  });

  it('rejects a deleted message', () => {
    const m = make();
    m.delete('user-1', 8);
    expect(() => m.edit('user-1', 'x', 9)).toThrow(MessageAlreadyDeletedError);
  });

  it('rejects a SYSTEM message', () => {
    const s = Message.system('chat-1', 'user-1', { type: 'group_created' }, 6);
    expect(() => s.edit('user-1', 'x', 9)).toThrow(SystemMessageImmutableError);
  });

  it('rejects empty content without attachments', () => {
    expect(() => make().edit('user-1', '   ', 9)).toThrow(EmptyMessageError);
  });

  it('allows empty content with attachments, storing null', () => {
    const m = make(1);
    m.edit('user-1', '', 9);
    expect(m.content).toBeNull();
  });

  it('rejects 2,001 chars and accepts 2,000', () => {
    expect(() => make().edit('user-1', 'a'.repeat(2001), 9)).toThrow(
      MessageTooLongError,
    );
    const m = make();
    m.edit('user-1', 'a'.repeat(2000), 9);
    expect(m.content).toHaveLength(2000);
  });
});

describe('Message.delete', () => {
  const make = () =>
    Message.create({ ...base, content: 'hi', attachments: ids(2) });

  it('clears content and attachments, sets deletedAt and changeSeq', () => {
    const m = make();
    m.delete('user-1', 9);
    expect(m.content).toBeNull();
    expect(m.attachmentIds).toEqual([]);
    expect(m.deletedAt).toBeInstanceOf(Date);
    expect(m.changeSeq).toBe(9);
  });

  it('rejects a non-author', () => {
    expect(() => make().delete('user-2', 9)).toThrow(NotMessageAuthorError);
  });

  it('rejects a second delete', () => {
    const m = make();
    m.delete('user-1', 9);
    expect(() => m.delete('user-1', 10)).toThrow(MessageAlreadyDeletedError);
  });

  it('rejects a SYSTEM message', () => {
    const s = Message.system('chat-1', 'user-1', { type: 'group_created' }, 6);
    expect(() => s.delete('user-1', 9)).toThrow(SystemMessageImmutableError);
  });
});
