import { splitMentions } from './mention-parser';

const long = 'a'.repeat(51);

describe('splitMentions', () => {
  it('returns one text part for plain text', () => {
    expect(splitMentions('just words')).toEqual([
      { type: 'text', value: 'just words' },
    ]);
  });

  it('returns no parts for empty text', () => {
    expect(splitMentions('')).toEqual([]);
  });

  it('splits mentions only', () => {
    expect(splitMentions('hi @alice and @bob.k!')).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'mention', value: '@alice', username: 'alice' },
      { type: 'text', value: ' and ' },
      { type: 'mention', value: '@bob.k', username: 'bob.k' },
      { type: 'text', value: '!' },
    ]);
  });

  it('keeps emails as text', () => {
    expect(splitMentions('mail a@b.com')).toEqual([
      { type: 'text', value: 'mail a@b.com' },
    ]);
  });

  it('splits hashtags only', () => {
    expect(splitMentions('go #Rust, #go_lang')).toEqual([
      { type: 'text', value: 'go ' },
      { type: 'hashtag', value: '#Rust', tag: 'rust' },
      { type: 'text', value: ', ' },
      { type: 'hashtag', value: '#go_lang', tag: 'go_lang' },
    ]);
  });

  it('keeps mixed mentions and hashtags in order', () => {
    expect(splitMentions('#one @bob #two')).toEqual([
      { type: 'hashtag', value: '#one', tag: 'one' },
      { type: 'text', value: ' ' },
      { type: 'mention', value: '@bob', username: 'bob' },
      { type: 'text', value: ' ' },
      { type: 'hashtag', value: '#two', tag: 'two' },
    ]);
  });

  it('splits adjacent mention and hashtag', () => {
    expect(splitMentions('@a #b')).toEqual([
      { type: 'mention', value: '@a', username: 'a' },
      { type: 'text', value: ' ' },
      { type: 'hashtag', value: '#b', tag: 'b' },
    ]);
  });

  it('lowercases and NFC-normalizes the tag', () => {
    expect(splitMentions('#Café')).toEqual([
      { type: 'hashtag', value: '#Café', tag: 'café' },
    ]);
  });

  it('agrees with core for an NFD #Café', () => {
    const nfd = '#Café time';
    const parts = splitMentions(nfd);
    expect(parts[0]).toEqual({
      type: 'hashtag',
      value: '#Café',
      tag: 'café',
    });
    expect(parts[1]).toEqual({ type: 'text', value: ' time' });
  });

  it('keeps URL fragments as text', () => {
    expect(splitMentions('see example.com/#x')).toEqual([
      { type: 'text', value: 'see example.com/#x' },
    ]);
  });

  it('keeps a # glued to a letter as text', () => {
    expect(splitMentions('café#x')).toEqual([
      { type: 'text', value: 'café#x' },
    ]);
  });

  it('keeps emails with a # in the local part as text', () => {
    expect(splitMentions('user#1@mail.com')).toEqual([
      { type: 'text', value: 'user#1@mail.com' },
    ]);
  });

  it('keeps a 51-char run as text but accepts 50', () => {
    expect(splitMentions(`#${long}`)).toEqual([
      { type: 'text', value: `#${long}` },
    ]);
    const fifty = 'a'.repeat(50);
    expect(splitMentions(`#${fifty}`)).toEqual([
      { type: 'hashtag', value: `#${fifty}`, tag: fifty },
    ]);
  });

  it('does not treat a lone # or ## as a tag', () => {
    expect(splitMentions('# 1 ##')).toEqual([
      { type: 'text', value: '# 1 ##' },
    ]);
  });
});
