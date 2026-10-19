import { ChatParticipant, ParticipantRole } from './chat-participant.entity';

const participant = (joinedSeq: number, lastReadSeq: number): ChatParticipant =>
  Object.assign(new ChatParticipant(), {
    role: ParticipantRole.MEMBER,
    joinedSeq,
    lastReadSeq,
    leftAt: null,
  });

describe('ChatParticipant', () => {
  describe('markRead', () => {
    it('advances lastReadSeq to the given seq', () => {
      const p = participant(0, 2);
      p.markRead(5, 10);
      expect(p.lastReadSeq).toBe(5);
    });

    it('clamps to the chat lastSeq', () => {
      const p = participant(0, 2);
      p.markRead(50, 10);
      expect(p.lastReadSeq).toBe(10);
    });

    it('never moves backwards', () => {
      const p = participant(0, 8);
      p.markRead(3, 10);
      expect(p.lastReadSeq).toBe(8);
    });

    it('never ends below joinedSeq', () => {
      const p = participant(7, 0);
      p.markRead(2, 10);
      expect(p.lastReadSeq).toBe(7);
    });
  });

  describe('isActive', () => {
    it('is true when leftAt is null', () => {
      expect(participant(0, 0).isActive()).toBe(true);
    });

    it('is false once leftAt is set', () => {
      const p = participant(0, 0);
      p.leftAt = new Date();
      expect(p.isActive()).toBe(false);
    });
  });
});
