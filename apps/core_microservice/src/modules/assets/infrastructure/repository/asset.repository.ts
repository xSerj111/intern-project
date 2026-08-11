import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeormRepositoryBase } from '@repo/shared';
import { Asset } from '../../domain/entities/asset.entity';

@Injectable()
export class AssetRepository extends TypeormRepositoryBase<Asset, any> {
  public static readonly entity = Asset;
  protected relations: string[] = [];

  constructor(@InjectRepository(Asset) repository: Repository<Asset>) {
    super(repository);
  }
}
