import { Injectable } from '@nestjs/common';
import { TypeormRepositoryBase } from '@repo/shared';
import { Follow } from '../../domain/entities/follow.entity';
import { FollowProps } from '../../domain/interfaces/follow.props';
import { IFollowRepository } from '../../domain/interfaces/follow-repository.port';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

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

  async findFollowers(userId: string): Promise<Follow[]> {
    return this.repository.find({ where: { followingId: userId } });
  }

  async findFollowing(userId: string): Promise<Follow[]> {
    return this.repository.find({ where: { followerId: userId } });
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
