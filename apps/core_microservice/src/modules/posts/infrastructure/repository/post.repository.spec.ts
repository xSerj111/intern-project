import type { Repository } from 'typeorm';

import type { Post } from '../../domain/entities/post.entity';
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
