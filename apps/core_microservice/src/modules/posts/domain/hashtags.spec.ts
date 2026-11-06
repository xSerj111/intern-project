import { normalizeHashtag } from '@repo/contracts';
import { extractHashtags, MAX_HASHTAGS_PER_POST } from './hashtags';

describe('extractHashtags', () => {
  it('finds a hashtag with accented letters', () => {
    expect(extractHashtags('I love #café')).toEqual(['café']);
  });

  it.each([['café#x'], ['see example.com/#x'], ['a_#x'], ['2#x']])(
    'does not treat the # in "%s" as a tag start',
    (content) => {
      expect(extractHashtags(content)).toEqual([]);
    },
  );

  it('treats a 50-character run as a tag', () => {
    const run = 'a'.repeat(50);

    expect(extractHashtags(`#${run}`)).toEqual([run]);
  });

  it('ignores a 51-character run instead of truncating it', () => {
    expect(extractHashtags(`#${'a'.repeat(51)}`)).toEqual([]);
  });

  it('accepts digit-only tags', () => {
    expect(extractHashtags('year #2024')).toEqual(['2024']);
  });

  it('collapses case variants into one tag', () => {
    expect(extractHashtags('#Tag #tag #TAG')).toEqual(['tag']);
  });

  it('collapses NFC and NFD forms of the same tag', () => {
    const nfc = '#café';
    const nfd = '#café';

    expect(extractHashtags(`${nfc} ${nfd}`)).toEqual(['café']);
  });

  it('keeps tags in order of first appearance', () => {
    expect(extractHashtags('#b #a #b #c')).toEqual(['b', 'a', 'c']);
  });

  it(`stops at ${MAX_HASHTAGS_PER_POST} distinct tags`, () => {
    const content = Array.from({ length: 25 }, (_, i) => `#t${i}`).join(' ');
    const tags = extractHashtags(content);

    expect(tags).toHaveLength(20);
    expect(tags[0]).toBe('t0');
    expect(tags[19]).toBe('t19');
  });

  it('returns [] for empty and tag-free content', () => {
    expect(extractHashtags('')).toEqual([]);
    expect(extractHashtags('no tags here # alone')).toEqual([]);
  });

  it.each([['#tag,'], ['#tag.'], ['(#tag)'], ['#tag!'], ['"#tag"']])(
    'ends the tag at punctuation in "%s"',
    (content) => {
      expect(extractHashtags(content)).toEqual(['tag']);
    },
  );
});

describe('normalizeHashtag', () => {
  it('strips one leading # only', () => {
    expect(normalizeHashtag('#tag')).toBe('tag');
    expect(normalizeHashtag('##tag')).toBe('#tag');
    expect(normalizeHashtag('tag')).toBe('tag');
  });

  it('lowercases', () => {
    expect(normalizeHashtag('#TaG')).toBe('tag');
  });

  it('normalizes to NFC', () => {
    expect(normalizeHashtag('#café')).toBe('café');
  });
});
