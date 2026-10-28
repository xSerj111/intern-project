import {
  ATTEMPTS_HEADER,
  decideOnFailure,
  describeError,
  readAttempt,
} from './retry-policy';

describe('readAttempt', () => {
  it('defaults to the first attempt when the header is missing', () => {
    expect(readAttempt(undefined)).toBe(1);
    expect(readAttempt({})).toBe(1);
  });

  it('reads numeric, string and bigint headers', () => {
    expect(readAttempt({ [ATTEMPTS_HEADER]: 3 })).toBe(3);
    expect(readAttempt({ [ATTEMPTS_HEADER]: '4' })).toBe(4);
    expect(readAttempt({ [ATTEMPTS_HEADER]: BigInt(2) })).toBe(2);
  });

  it.each([0, -1, 1.5, 'abc', null, {}])(
    'treats %p as the first attempt',
    (value) => {
      expect(readAttempt({ [ATTEMPTS_HEADER]: value })).toBe(1);
    },
  );
});

describe('decideOnFailure', () => {
  const events = { maxAttempts: 5, hasDeadLetterQueue: true, poison: false };
  const email = { maxAttempts: 3, hasDeadLetterQueue: false, poison: false };

  it.each([1, 2, 3, 4])(
    'retries attempt %i of 5 with the next attempt',
    (a) => {
      expect(decideOnFailure({ ...events, attempt: a })).toEqual({
        action: 'retry',
        nextAttempt: a + 1,
      });
    },
  );

  it('dead-letters after the 5th attempt', () => {
    expect(decideOnFailure({ ...events, attempt: 5 })).toEqual({
      action: 'dead-letter',
    });
  });

  it('dead-letters an over-counted attempt instead of retrying forever', () => {
    expect(decideOnFailure({ ...events, attempt: 9 })).toEqual({
      action: 'dead-letter',
    });
  });

  it('dead-letters poison messages on the first attempt', () => {
    expect(decideOnFailure({ ...events, attempt: 1, poison: true })).toEqual({
      action: 'dead-letter',
    });
  });

  it('drops an exhausted email job (no DLQ) after 3 attempts', () => {
    expect(decideOnFailure({ ...email, attempt: 2 })).toEqual({
      action: 'retry',
      nextAttempt: 3,
    });
    expect(decideOnFailure({ ...email, attempt: 3 })).toEqual({
      action: 'drop',
    });
    expect(decideOnFailure({ ...email, attempt: 1, poison: true })).toEqual({
      action: 'drop',
    });
  });
});

describe('describeError', () => {
  it('includes the error name and bounds the length', () => {
    expect(describeError(new TypeError('boom'))).toBe('TypeError: boom');
    expect(describeError('x'.repeat(1000), 10)).toHaveLength(10);
  });
});
