import { Message } from './message.entity';
import {
  EmptyMessageError,
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

const ids = (n: number) => Array.from({ length: n }, (_, i) => `asset-${i}`);

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
    expect(() => Message.create({ ...base, attachmentIds: ids(11) })).toThrow(
      TooManyAttachmentsError,
    );
    expect(() =>
      Message.create({ ...base, attachmentIds: ids(10) }),
    ).not.toThrow();
  });

  it('accepts attachments only, storing null content', () => {
    const m = Message.create({ ...base, content: '  ', attachmentIds: ids(1) });
    expect(m.content).toBeNull();
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

describe('Message.edit', () => {
  const make = (attachments = 0) =>
    Message.create({
      ...base,
      content: 'hi',
      attachmentIds: ids(attachments),
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
    Message.create({ ...base, content: 'hi', attachmentIds: ids(2) });

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
