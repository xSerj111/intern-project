import { escapeLikePattern } from './like-pattern';

describe('escapeLikePattern', () => {
  it('leaves plain text unchanged', () => {
    expect(escapeLikePattern('alice')).toBe('alice');
  });

  it('escapes %, _ and backslash', () => {
    expect(escapeLikePattern('a%b_c')).toBe('a\\%b\\_c');
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
  });

  it('escapes the backslash before the wildcards', () => {
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%');
  });
});
