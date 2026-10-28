import { In, type Repository } from 'typeorm';

import type { Post } from '../../domain/entities/post.entity';
import { FeedCursor } from '../../domain/feed-cursor';
import { PostRepository } from './post.repository';

describe('PostRepository.searchPublishedPosts', () => {
  const build = () => {
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest
        .fn<unknown, [string, Record<string, unknown>]>()
        .mockReturnThis(),
      andWhere: jest.fn<unknown, [string]>().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const createQueryBuilder = jest.fn().mockReturnValue(qb);
    const repository = { createQueryBuilder } as unknown as Repository<Post>;
    return { qb, createQueryBuilder, repo: new PostRepository(repository) };
  };

  it('matches the content with a bound, escaped ILIKE parameter', async () => {
    const { qb, repo } = build();

    await repo.searchPublishedPosts('100%_a\\b', 1, 20);

    expect(qb.where).toHaveBeenCalledWith(
      "p.content ILIKE '%' || :q || '%' ESCAPE '\\'",
      { q: '100\\%\\_a\\\\b' },
    );
    const [sql] = qb.where.mock.calls[0];
    expect(sql).not.toContain('100');
  });

  it('filters on a literal published status so the partial index matches', async () => {
    const { qb, repo } = build();

    await repo.searchPublishedPosts('hello', 1, 20);

    expect(qb.andWhere).toHaveBeenCalledWith("p.status = 'published'");
  });

  it('joins author and assets, orders newest first and pages with skip/take', async () => {
    const { qb, createQueryBuilder, repo } = build();
    const post = { id: 'p1' } as Post;
    qb.getManyAndCount.mockResolvedValue([[post], 41]);

    const result = await repo.searchPublishedPosts('hello', 3, 20);

    expect(createQueryBuilder).toHaveBeenCalledWith('p');
    expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('p.author', 'author');
    expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('p.assets', 'assets');
    expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('assets.asset', 'asset');
    expect(qb.orderBy).toHaveBeenCalledWith('p.createdAt', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('p.id', 'DESC');
    expect(qb.skip).toHaveBeenCalledWith(40);
    expect(qb.take).toHaveBeenCalledWith(20);
    expect(result).toEqual([[post], 41]);
  });
});

const ROW_1 = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  t: '2026-01-03T00:00:00.000003Z',
};
const ROW_2 = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  t: '2026-01-02T00:00:00.000002Z',
};
const ROW_3 = {
  id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  t: '2026-01-01T00:00:00.000001Z',
};

const buildRaw = () => {
  const query = jest.fn<Promise<unknown>, [string, unknown[]]>();
  const find = jest.fn<Promise<Post[]>, [unknown]>().mockResolvedValue([]);
  const repository = { query, find } as unknown as Repository<Post>;
  return { query, find, repo: new PostRepository(repository) };
};

describe('PostRepository.searchHashtags', () => {
  it('binds the escaped prefix and the limit, never interpolating input', async () => {
    const { query, repo } = buildRaw();
    query.mockResolvedValue([]);

    await repo.searchHashtags('a_b%c\\d', 10);

    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual(['a\\_b\\%c\\\\d', 10]);
    expect(sql).toContain("tag LIKE $1 || '%' ESCAPE '\\'");
    expect(sql).toContain('LIMIT $2');
    expect(sql).not.toContain('a_b');
  });

  it('counts only published, non-deleted posts with a literal status', async () => {
    const { query, repo } = buildRaw();
    query.mockResolvedValue([]);

    await repo.searchHashtags('sum', 10);

    const [sql] = query.mock.calls[0];
    expect(sql).toContain("p.status = 'published'");
    expect(sql).toContain('p."deletedAt" IS NULL');
    expect(sql).toContain('unnest(p.hashtags) AS tag');
    expect(sql).toMatch(/ORDER BY "postCount" DESC, tag ASC/);
  });

  it('returns tag and numeric postCount per row', async () => {
    const { query, repo } = buildRaw();
    query.mockResolvedValue([
      { tag: 'summer', postCount: 2 },
      { tag: 'summit', postCount: '1' },
    ]);

    await expect(repo.searchHashtags('sum', 10)).resolves.toEqual([
      { tag: 'summer', postCount: 2 },
      { tag: 'summit', postCount: 1 },
    ]);
  });
});

describe('PostRepository.findByHashtagPage', () => {
  it('filters with @> on the bound tag, a literal status and deletedAt', async () => {
    const { query, find, repo } = buildRaw();
    query.mockResolvedValue([]);

    const result = await repo.findByHashtagPage('summer', null, 2);

    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual(['summer', 3]);
    expect(sql).toContain('p.hashtags @> ARRAY[$1]::text[]');
    expect(sql).toContain("p.status = 'published'");
    expect(sql).toContain('p."deletedAt" IS NULL');
    expect(sql).toMatch(/ORDER BY p\."createdAt" DESC, p\.id DESC\s+LIMIT \$2/);
    expect(sql).not.toContain('$3');
    expect(sql).not.toContain('summer');
    expect(find).not.toHaveBeenCalled();
    expect(result).toEqual({ posts: [], nextCursor: null });
  });

  it('adds the keyset predicate with the cursor bound as $3/$4', async () => {
    const { query, repo } = buildRaw();
    query.mockResolvedValue([]);
    const cursor = FeedCursor.fromRow(ROW_1);

    await repo.findByHashtagPage('summer', cursor, 2);

    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual(['summer', 3, ROW_1.t, ROW_1.id]);
    expect(sql).toContain(
      'AND (p."createdAt", p.id) < ($3::timestamptz, $4::uuid)',
    );
  });

  it('returns limit posts in id order and a cursor from the last one', async () => {
    const { query, find, repo } = buildRaw();
    query.mockResolvedValue([ROW_1, ROW_2, ROW_3]);
    const p1 = { id: ROW_1.id } as Post;
    const p2 = { id: ROW_2.id } as Post;
    // Hydration returns rows in arbitrary order.
    find.mockResolvedValue([p2, p1]);

    const result = await repo.findByHashtagPage('summer', null, 2);

    expect(find).toHaveBeenCalledWith({
      where: { id: In([ROW_1.id, ROW_2.id]) },
      relations: { author: true, assets: { asset: true } },
    });
    expect(result.posts).toEqual([p1, p2]);
    expect(result.nextCursor).toBe(FeedCursor.fromRow(ROW_2).encode());
  });

  it('returns a null cursor on the last page and drops posts gone since', async () => {
    const { query, find, repo } = buildRaw();
    query.mockResolvedValue([ROW_1, ROW_2]);
    const p2 = { id: ROW_2.id } as Post;
    find.mockResolvedValue([p2]);

    const result = await repo.findByHashtagPage('summer', null, 2);

    expect(result).toEqual({ posts: [p2], nextCursor: null });
  });
});

describe('PostRepository.findFeedPage', () => {
  it('pages and hydrates through the same helpers as the hashtag feed', async () => {
    const { query, find, repo } = buildRaw();
    query.mockResolvedValue([ROW_1, ROW_2, ROW_3]);
    const p1 = { id: ROW_1.id } as Post;
    const p2 = { id: ROW_2.id } as Post;
    find.mockResolvedValue([p2, p1]);
    const viewer = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

    const result = await repo.findFeedPage(viewer, null, 2);

    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([viewer, 3]);
    expect(sql).toContain("p.status = 'published'");
    expect(result).toEqual({
      posts: [p1, p2],
      nextCursor: FeedCursor.fromRow(ROW_2).encode(),
    });
  });
});
