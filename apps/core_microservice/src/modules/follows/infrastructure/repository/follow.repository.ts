import { Injectable } from "@nestjs/common";
import { TypeormRepositoryBase } from "@repo/shared";
import { Follow } from "../../domain/entities/follow.entity";
import { FollowProps } from "../../domain/interfaces/follow.props";
import { IFollowRepository } from "../../domain/interfaces/follow-repository.port";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

@Injectable()
export class FollowRepository extends TypeormRepositoryBase<Follow, FollowProps> implements IFollowRepository
{
  // obligated by base class
  public static readonly entity = Follow;

  protected relations: string[] = [];

  constructor(@InjectRepository(Follow) repository: Repository<Follow>) {
    super(repository);
  }

  // implement methods from Port
  async findByFollowerAndFollowing(followerId: string, followingId: string): Promise<Follow | null> {
    return this.repository.findOne({ where: { followerId, followingId } });
  }

  async findFollowers(userId: string): Promise<Follow[]> {
    return this.repository.find({ where: { followingId: userId } });
  }

  async findFollowing(userId: string): Promise<Follow[]> {
    return this.repository.find({ where: { followerId: userId } });
  }
}