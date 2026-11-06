import {
  isQueryLongEnough,
  MIN_QUERY_LENGTH,
  parseTab,
  SEARCH_TABS,
} from './search-limits';

describe('search-limits', () => {
  it('lists the tabs and minimum lengths', () => {
    expect(SEARCH_TABS).toEqual(['people', 'posts', 'tags']);
    expect(MIN_QUERY_LENGTH).toEqual({ people: 2, posts: 3, tags: 1 });
  });

  describe('parseTab', () => {
    it.each(['people', 'posts', 'tags'])('keeps valid tab %s', (tab) => {
      expect(parseTab(tab, true)).toBe(tab);
      expect(parseTab(tab, false)).toBe(tab);
    });

    it('defaults to people when signed in', () => {
      expect(parseTab(undefined, true)).toBe('people');
      expect(parseTab(null, true)).toBe('people');
      expect(parseTab('nope', true)).toBe('people');
    });

    it('defaults to posts when signed out', () => {
      expect(parseTab(undefined, false)).toBe('posts');
      expect(parseTab('', false)).toBe('posts');
      expect(parseTab('nope', false)).toBe('posts');
    });
  });

  describe('isQueryLongEnough', () => {
    it('applies the people minimum of 2', () => {
      expect(isQueryLongEnough('people', 'a')).toBe(false);
      expect(isQueryLongEnough('people', 'ab')).toBe(true);
    });

    it('applies the posts minimum of 3', () => {
      expect(isQueryLongEnough('posts', 'ab')).toBe(false);
      expect(isQueryLongEnough('posts', 'abc')).toBe(true);
    });

    it('applies the tags minimum of 1 after stripping one leading #', () => {
      expect(isQueryLongEnough('tags', '')).toBe(false);
      expect(isQueryLongEnough('tags', '#')).toBe(false);
      expect(isQueryLongEnough('tags', 'a')).toBe(true);
      expect(isQueryLongEnough('tags', '#a')).toBe(true);
      expect(isQueryLongEnough('tags', '##')).toBe(true);
    });

    it('only strips # for tags', () => {
      expect(isQueryLongEnough('people', '#a')).toBe(true);
      expect(isQueryLongEnough('posts', '#a')).toBe(false);
    });
  });
});
