import { Chat, ChatType } from './chat.entity';
import { ChatParticipant } from './chat-participant.entity';
import {
  CannotChatWithSelfError,
  ChatNotFoundError,
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
