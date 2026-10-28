import { EmailDeliveryFinalizedError } from '../errors/notification.errors';
import { EmailDelivery, MAX_EMAIL_ATTEMPTS } from './email-delivery.entity';

const pending = () =>
  EmailDelivery.pending(
    'event:recipient',
    '11111111-1111-4111-8111-111111111111',
    'NEW_MESSAGE',
  );

describe('EmailDelivery', () => {
  describe('recordFailure', () => {
    it('stays PENDING until the maximum number of attempts', () => {
      const delivery = pending();
      delivery.recordFailure(new Error('smtp'));
      expect(delivery.status).toBe('PENDING');
      expect(delivery.attempts).toBe(1);
      expect(delivery.lastError).toBe('smtp');
    });

    it('becomes FAILED on the final attempt', () => {
      const delivery = pending();
      for (let i = 0; i < MAX_EMAIL_ATTEMPTS; i++) {
        delivery.recordFailure('boom');
      }
      expect(delivery.status).toBe('FAILED');
      expect(delivery.lastError).toBe('boom');
    });
  });

  describe('markFailed', () => {
    it('closes a fresh delivery as FAILED with the maximum attempts', () => {
      const delivery = pending();
      delivery.markFailed(new Error('no address'));
      expect(delivery.status).toBe('FAILED');
      expect(delivery.attempts).toBe(MAX_EMAIL_ATTEMPTS);
      expect(delivery.lastError).toBe('no address');
    });

    it('keeps the recorded attempts when they are already at the maximum', () => {
      const delivery = pending();
      delivery.attempts = MAX_EMAIL_ATTEMPTS + 1;
      delivery.markFailed('x');
      expect(delivery.attempts).toBe(MAX_EMAIL_ATTEMPTS + 1);
    });

    it('rejects a delivery that is already closed', () => {
      const sent = pending();
      sent.markSent(new Date());
      expect(() => sent.markFailed('x')).toThrow(EmailDeliveryFinalizedError);

      const failed = pending();
      failed.markFailed('x');
      expect(() => failed.markFailed('y')).toThrow(EmailDeliveryFinalizedError);
    });
  });
});
