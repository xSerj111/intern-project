import type { Repository } from 'typeorm';

import type { UserProfile } from '../../domain/entities/user-profile.entity';
import { UserProfileRepository } from './user-profile.repository';

describe('UserProfileRepository.searchByUsername', () => {
  const build = () => {
    const qb = {
      where: jest
        .fn<unknown, [string, Record<string, unknown>]>()
        .mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      orderBy: jest.fn<unknown, [string, string]>().mockReturnThis(),
      addOrderBy: jest.fn<unknown, [string, string]>().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as Repository<UserProfile>;
    return { qb, repo: new UserProfileRepository(repository) };
  };

  it('matches username OR display name infix with a bound, escaped parameter', async () => {
    const { qb, repo } = build();

    await repo.searchByUsername('Al_%', 10, 'me');

    expect(qb.where).toHaveBeenCalledWith(
      "(lower(p.username) LIKE '%' || lower(:q) || '%' ESCAPE '\\' OR lower(p.\"displayName\") LIKE '%' || lower(:q) || '%' ESCAPE '\\')",
      { q: 'Al\\_\\%' },
    );
    const [sql] = qb.where.mock.calls[0];
    expect(sql).not.toContain('Al');
    expect(sql.match(/ESCAPE '\\'/g)).toHaveLength(2);
    expect(qb.andWhere).toHaveBeenCalledWith(
      'p.authUserId != :excludeAuthUserId',
      { excludeAuthUserId: 'me' },
    );
    expect(qb.take).toHaveBeenCalledWith(10);
  });

  it('binds the unescaped query as :raw for ranking', async () => {
    const { qb, repo } = build();

    await repo.searchByUsername('Al_%', 10, 'me');

    expect(qb.setParameter).toHaveBeenCalledWith('raw', 'Al_%');
  });

  it('orders exact username, then username prefix, then similarity, then username', async () => {
    const { qb, repo } = build();

    await repo.searchByUsername('alice', 5, 'me');

    expect(qb.orderBy).toHaveBeenCalledWith(
      'lower(p.username) = lower(:raw)',
      'DESC',
    );
    expect(qb.addOrderBy.mock.calls).toEqual([
      ["lower(p.username) LIKE lower(:q) || '%' ESCAPE '\\'", 'DESC'],
      [
        'greatest(similarity(lower(p.username), lower(:raw)), similarity(lower(coalesce(p."displayName", \'\')), lower(:raw)))',
        'DESC',
      ],
      ['p.username', 'ASC'],
    ]);
    const orderSql = [
      qb.orderBy.mock.calls[0][0],
      ...qb.addOrderBy.mock.calls.map(([expr]) => expr),
    ].join(' ');
    expect(orderSql).not.toContain('alice');
  });
});
