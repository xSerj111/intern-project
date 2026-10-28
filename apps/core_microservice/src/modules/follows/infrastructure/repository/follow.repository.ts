import { Injectable } from '@nestjs/common';
import { TypeormRepositoryBase } from '@repo/shared';
import { Follow } from '../../domain/entities/follow.entity';
import { FollowProps } from '../../domain/interfaces/follow.props';
import {
  FollowPaging,
  IFollowRepository,
} from '../../domain/interfaces/follow-repository.port';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOptionsWhere, Repository } from 'typeorm';

@Injectable()
export class FollowRepository
  extends TypeormRepositoryBase<Follow, FollowProps>
  implements IFollowRepository
{
  // obligated by base class
  public static readonly entity = Follow;

  protected relations: string[] = [];

  constructor(@InjectRepository(Follow) repository: Repository<Follow>) {
    super(repository);
  }

  // implement methods from Port
  async findByFollowerAndFollowing(
    followerId: string,
    followingId: string,
  ): Promise<Follow | null> {
    return this.repository.findOne({ where: { followerId, followingId } });
  }

  async findFollowers(userId: string, paging: FollowPaging): Promise<Follow[]> {
    return this.findOrdered({ followingId: userId }, paging);
  }

  async findFollowing(userId: string, paging: FollowPaging): Promise<Follow[]> {
    return this.findOrdered({ followerId: userId }, paging);
  }

  async findFollowedAmong(
    viewerId: string,
    userIds: string[],
  ): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await this.repository
      .createQueryBuilder('f')
      .select('f.followingId', 'followingId')
      .where('f.followerId = :viewerId', { viewerId })
      .andWhere('f.followingId IN (:...userIds)', { userIds })
      .getRawMany<{ followingId: string }>();
    return new Set(rows.map((r) => r.followingId));
  }

  /** Takes `limit + 1` rows (hasMore without a COUNT). */
  private findOrdered(
    where: FindOptionsWhere<Follow>,
    paging: FollowPaging,
  ): Promise<Follow[]> {
    return this.repository.find({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: paging.offset,
      take: paging.limit + 1,
    });
  }

  /**
   * Inside a transaction the raw TypeORM error propagates so the caller's
   * transaction wrapper maps it; outside, the base `save` maps it.
   */
  override async save(follow: Follow, tx?: EntityManager): Promise<Follow> {
    if (!tx) return super.save(follow);
    return tx.getRepository(Follow).save(follow);
  }

  async runInTransaction<T>(
    work: (tx: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.repository.manager.transaction(work);
  }
}
