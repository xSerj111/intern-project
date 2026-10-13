import { Message } from './message.entity';
import {
  EmptyMessageError,
  MessageTooLongError,
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
