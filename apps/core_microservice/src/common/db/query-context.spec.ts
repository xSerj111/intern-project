import {
  currentQueryCount,
  incrementQueryCount,
  runWithQueryContext,
} from './query-context';

const tick = () => new Promise((r) => setTimeout(r, 1));

describe('query-context', () => {
  it('isolates counts between concurrent contexts', async () => {
    const run = (n: number) =>
      runWithQueryContext(async () => {
        for (let i = 0; i < n; i++) {
          await tick();
          incrementQueryCount();
        }
        return currentQueryCount();
      });

    const [a, b] = await Promise.all([run(2), run(5)]);

    expect(a).toBe(2);
    expect(b).toBe(5);
  });

  it('counts queries started inside Promise.all', async () => {
    const count = await runWithQueryContext(async () => {
      await Promise.all(
        [1, 2, 3].map(async () => {
          await tick();
          incrementQueryCount();
        }),
      );
      return currentQueryCount();
    });

    expect(count).toBe(3);
  });

  it('incrementQueryCount outside a context is a no-op', () => {
    expect(() => incrementQueryCount()).not.toThrow();
    expect(currentQueryCount()).toBeUndefined();
  });
});
