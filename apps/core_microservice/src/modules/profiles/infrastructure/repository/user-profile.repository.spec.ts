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
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as Repository<UserProfile>;
    return { qb, repo: new UserProfileRepository(repository) };
  };

  it('uses an index-friendly lower(username) prefix LIKE with a bound, escaped parameter', async () => {
    const { qb, repo } = build();

    await repo.searchByUsername('Al_%', 10, 'me');

    expect(qb.where).toHaveBeenCalledWith(
      "lower(p.username) LIKE (lower(:q) || '%') ESCAPE '\\'",
      { q: 'Al\\_\\%' },
    );
    const [sql] = qb.where.mock.calls[0];
    expect(sql).not.toContain('Al');
    expect(sql).toMatch(/ESCAPE '\\'$/);
    expect(qb.andWhere).toHaveBeenCalledWith(
      'p.authUserId != :excludeAuthUserId',
      { excludeAuthUserId: 'me' },
    );
    expect(qb.orderBy).toHaveBeenCalledWith('p.username', 'ASC');
    expect(qb.take).toHaveBeenCalledWith(10);
  });
});
