import { Chat, ChatType } from './chat.entity';
import { ChatParticipant, ParticipantRole } from './chat-participant.entity';
import { Message } from './message.entity';
import {
  CannotChatWithSelfError,
  ChatNotFoundError,
  InvalidGroupSizeError,
  InvalidGroupTitleError,
  NotAGroupChatError,
  NotAParticipantError,
  NotChatAdminError,
} from '../errors/chat.errors';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('Chat', () => {
  describe('createDirect', () => {
    it('rejects a chat with yourself', () => {
      expect(() => Chat.createDirect(A, A)).toThrow(CannotChatWithSelfError);
    });

    it('builds the same directKey regardless of argument order', () => {
      const ab = Chat.createDirect(A, B);
      const ba = Chat.createDirect(B, A);

      expect(ab.directKey).toBe(`${A}:${B}`);
      expect(ba.directKey).toBe(ab.directKey);
    });

    it('creates a titleless DIRECT chat with two MEMBER participants', () => {
      const chat = Chat.createDirect(B, A);

      expect(chat.type).toBe(ChatType.DIRECT);
      expect(chat.title).toBeNull();
      expect(chat.lastSeq).toBe(0);
      expect(chat.participants).toHaveLength(2);
      expect(chat.participants.map((p) => p.userId).sort()).toEqual([A, B]);
      for (const p of chat.participants) {
        expect(p.role).toBe('MEMBER');
        expect(p.joinedSeq).toBe(0);
      }
    });
  });

  describe('assertCanRead / assertCanPost', () => {
    it('allows active participants', () => {
      const chat = Chat.createDirect(A, B);

      expect(() => chat.assertCanRead(A)).not.toThrow();
      expect(() => chat.assertCanPost(B)).not.toThrow();
    });

    it('throws ChatNotFoundError for a non-participant', () => {
      const chat = Chat.createDirect(A, B);

      expect(() => chat.assertCanRead(C)).toThrow(ChatNotFoundError);
      expect(() => chat.assertCanPost(C)).toThrow(ChatNotFoundError);
    });

    it('throws ChatNotFoundError for a participant who left', () => {
      const chat = Chat.createDirect(A, B);
      chat.participantOf(B)!.leftAt = new Date();

      expect(() => chat.assertCanRead(B)).toThrow(ChatNotFoundError);
      expect(() => chat.assertCanPost(B)).toThrow(ChatNotFoundError);
      expect(
        chat.activeParticipants().map((p: ChatParticipant) => p.userId),
      ).toEqual([A]);
    });
  });
});

// Deterministic user ids: u(1) = '00000000-0000-4000-8000-000000000001'.
const u = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const users = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => u(from + i));

const group = (memberCount = 2) =>
  Chat.createGroup(u(0), 'Team', users(1, memberCount)).chat;

describe('Chat groups', () => {
  describe('createGroup', () => {
    it('rejects a title that is empty or over 100 chars after trim', () => {
      expect(() => Chat.createGroup(u(0), '   ', users(1, 2))).toThrow(
        InvalidGroupTitleError,
      );
      expect(() =>
        Chat.createGroup(u(0), 'a'.repeat(101), users(1, 2)),
      ).toThrow(InvalidGroupTitleError);
      expect(
        Chat.createGroup(u(0), `  ${'a'.repeat(100)}  `, users(1, 2)).chat
          .title,
      ).toHaveLength(100);
    });

    it('rejects fewer than 2 or more than 99 other members', () => {
      expect(() => Chat.createGroup(u(0), 'T', users(1, 1))).toThrow(
        InvalidGroupSizeError,
      );
      expect(() => Chat.createGroup(u(0), 'T', users(1, 100))).toThrow(
        InvalidGroupSizeError,
      );
      expect(() => Chat.createGroup(u(0), 'T', users(1, 99))).not.toThrow();
    });

    it('rejects duplicate members or the creator among members', () => {
      expect(() => Chat.createGroup(u(0), 'T', [u(1), u(1), u(2)])).toThrow(
        InvalidGroupSizeError,
      );
      expect(() => Chat.createGroup(u(0), 'T', [u(0), u(1), u(2)])).toThrow(
        InvalidGroupSizeError,
      );
    });

    it('makes the creator ADMIN and returns a group_created event', () => {
      const { chat, events } = Chat.createGroup(u(0), '  Team  ', [u(1), u(2)]);

      expect(chat.type).toBe(ChatType.GROUP);
      expect(chat.title).toBe('Team');
      expect(chat.directKey).toBeNull();
      expect(chat.createdById).toBe(u(0));
      expect(chat.participantOf(u(0))!.role).toBe(ParticipantRole.ADMIN);
      expect(chat.participantOf(u(1))!.role).toBe(ParticipantRole.MEMBER);
      expect(chat.activeParticipants()).toHaveLength(3);
      expect(events).toEqual([
        {
          type: 'group_created',
          actorId: u(0),
          targetUserIds: [u(1), u(2)],
          title: 'Team',
        },
      ]);
    });
  });

  describe('addMembers', () => {
    it('rejects a non-admin actor', () => {
      const chat = group();
      expect(() => chat.addMembers(u(1), [u(9)])).toThrow(NotChatAdminError);
    });

    it('rejects going past 100 active members', () => {
      const chat = group(98); // 99 active
      expect(() => chat.addMembers(u(0), [u(200), u(201)])).toThrow(
        InvalidGroupSizeError,
      );
      expect(chat.activeParticipants()).toHaveLength(99);
      expect(() => chat.addMembers(u(0), [u(200)])).not.toThrow();
      expect(chat.activeParticipants()).toHaveLength(100);
    });

    it('inserts new users as MEMBER at the current lastSeq', () => {
      const chat = group();
      chat.lastSeq = 7;

      const events = chat.addMembers(u(0), [u(9)]);

      const p = chat.participantOf(u(9))!;
      expect(p.role).toBe(ParticipantRole.MEMBER);
      expect(p.joinedSeq).toBe(7);
      expect(events).toEqual([
        { type: 'member_added', actorId: u(0), targetUserIds: [u(9)] },
      ]);
    });

    it('reactivates the existing row of a departed user', () => {
      const chat = group();
      const original = chat.participants.find((p) => p.userId === u(1))!;
      const oldJoinedAt = new Date('2020-01-01T00:00:00Z');
      original.joinedAt = oldJoinedAt;
      chat.removeMember(u(0), u(1));
      chat.lastSeq = 12;

      chat.addMembers(u(0), [u(1)]);

      const rows = chat.participants.filter((p) => p.userId === u(1));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toBe(original);
      expect(original.leftAt).toBeNull();
      expect(original.joinedAt.getTime()).toBeGreaterThan(
        oldJoinedAt.getTime(),
      );
      expect(original.joinedSeq).toBe(12);
      expect(original.role).toBe(ParticipantRole.MEMBER);
    });

    it('skips users who are already active', () => {
      const chat = group();
      expect(chat.addMembers(u(0), [u(1)])).toEqual([]);
      expect(chat.activeParticipants()).toHaveLength(3);
    });
  });

  describe('removeMember', () => {
    it('rejects removing yourself or a non-member', () => {
      const chat = group();
      expect(() => chat.removeMember(u(0), u(0))).toThrow(NotAParticipantError);
      expect(() => chat.removeMember(u(0), u(9))).toThrow(NotAParticipantError);
    });

    it('requires admin', () => {
      const chat = group();
      expect(() => chat.removeMember(u(1), u(2))).toThrow(NotChatAdminError);
    });

    it('sets leftAt and returns a member_removed event', () => {
      const chat = group();
      const events = chat.removeMember(u(0), u(1));

      expect(chat.participantOf(u(1))).toBeUndefined();
      expect(
        chat.participants.find((p) => p.userId === u(1))!.leftAt,
      ).toBeInstanceOf(Date);
      expect(events).toEqual([
        { type: 'member_removed', actorId: u(0), targetUserIds: [u(1)] },
      ]);
    });
  });

  describe('promote', () => {
    it('requires admin', () => {
      const chat = group();
      expect(() => chat.promote(u(1), u(2))).toThrow(NotChatAdminError);
    });

    it('rejects a target who is not an active member', () => {
      const chat = group();
      expect(() => chat.promote(u(0), u(9))).toThrow(NotAParticipantError);
    });

    it('makes a MEMBER an ADMIN and returns admin_promoted', () => {
      const chat = group();
      const events = chat.promote(u(0), u(1));

      expect(chat.participantOf(u(1))!.role).toBe(ParticipantRole.ADMIN);
      expect(events).toEqual([
        { type: 'admin_promoted', actorId: u(0), targetUserIds: [u(1)] },
      ]);
    });
  });

  describe('rename', () => {
    it('requires admin', () => {
      const chat = group();
      expect(() => chat.rename(u(1), 'New')).toThrow(NotChatAdminError);
    });

    it('validates the title', () => {
      const chat = group();
      expect(() => chat.rename(u(0), ' ')).toThrow(InvalidGroupTitleError);
    });

    it('trims the title and returns group_renamed', () => {
      const chat = group();
      const events = chat.rename(u(0), '  New  ');

      expect(chat.title).toBe('New');
      expect(events).toEqual([
        { type: 'group_renamed', actorId: u(0), title: 'New' },
      ]);
    });
  });

  describe('leave', () => {
    it('rejects a non-member', () => {
      const chat = group();
      expect(() => chat.leave(u(9))).toThrow(NotAParticipantError);
    });

    it('returns member_left only while an admin remains', () => {
      const chat = group();
      const events = chat.leave(u(1));

      expect(chat.participantOf(u(1))).toBeUndefined();
      expect(events).toEqual([{ type: 'member_left', actorId: u(1) }]);
    });

    it('promotes the earliest joinedAt, then joinedSeq, then userId', () => {
      const chat = group(4);
      const at = (iso: string) => new Date(iso);
      const row = (n: number) =>
        chat.participants.find((p) => p.userId === u(n))!;
      row(1).joinedAt = at('2024-01-02T00:00:00Z');
      row(2).joinedAt = at('2024-01-01T00:00:00Z');
      row(2).joinedSeq = 5;
      row(3).joinedAt = at('2024-01-01T00:00:00Z');
      row(3).joinedSeq = 3;
      row(4).joinedAt = at('2024-01-01T00:00:00Z');
      row(4).joinedSeq = 3;

      const events = chat.leave(u(0));

      expect(row(3).role).toBe(ParticipantRole.ADMIN);
      expect(row(4).role).toBe(ParticipantRole.MEMBER);
      expect(events).toEqual([
        { type: 'member_left', actorId: u(0) },
        { type: 'admin_promoted', actorId: u(0), targetUserIds: [u(3)] },
      ]);
    });

    it('does not promote when another admin is still active', () => {
      const chat = group();
      chat.promote(u(0), u(2));
      expect(chat.leave(u(0))).toHaveLength(1);
      expect(chat.participantOf(u(1))!.role).toBe(ParticipantRole.MEMBER);
    });

    it('does not promote when nobody is left', () => {
      const chat = group();
      chat.leave(u(1));
      chat.leave(u(2));
      expect(chat.leave(u(0))).toEqual([
        { type: 'member_left', actorId: u(0) },
      ]);
      expect(chat.activeParticipants()).toHaveLength(0);
    });
  });

  describe('on a DIRECT chat', () => {
    it('throws NotAGroupChatError from every group method', () => {
      const chat = Chat.createDirect(A, B);

      expect(() => chat.addMembers(A, [C])).toThrow(NotAGroupChatError);
      expect(() => chat.removeMember(A, B)).toThrow(NotAGroupChatError);
      expect(() => chat.promote(A, B)).toThrow(NotAGroupChatError);
      expect(() => chat.rename(A, 'x')).toThrow(NotAGroupChatError);
      expect(() => chat.leave(A)).toThrow(NotAGroupChatError);
    });
  });
});

describe('Message.system', () => {
  it('builds a SYSTEM message carrying the event', () => {
    const m = Message.system(
      'chat-1',
      u(0),
      { type: 'member_added', actorId: u(0), targetUserIds: [u(1)] },
      8,
    );

    expect(m.kind).toBe('SYSTEM');
    expect(m.authorId).toBe(u(0));
    expect(m.content).toBeNull();
    expect(m.clientMessageId).toBeNull();
    expect(m.seq).toBe(8);
    expect(m.changeSeq).toBe(8);
    expect(m.systemEvent).toEqual({
      type: 'member_added',
      actorId: u(0),
      targetUserIds: [u(1)],
    });
  });
});
