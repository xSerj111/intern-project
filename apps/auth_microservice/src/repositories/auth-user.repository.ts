import { TypeormRepositoryBase } from '@repo/shared';
import { DataSource, Repository } from 'typeorm';
import { AuthUser } from '../entities/auth-user.entity';
import { IAuthUserRepository } from '../services/interfaces/auth-user-repository.interface';

export class AuthUserRepository
  extends TypeormRepositoryBase<AuthUser, any>
  implements IAuthUserRepository
{
  public static readonly entity = AuthUser;
  protected relations: string[] = [];

  constructor(dataSource: DataSource) {
    // Inicjalizujemy bazową klasę ze współdzielonej paczki przekazując jej natywne repozytorium TypeORM
    super(dataSource.getRepository(AuthUser));
  }

  async findByEmail(email: string): Promise<AuthUser | null> {
    return this.repository.findOne({ where: { email } });
  }
}
