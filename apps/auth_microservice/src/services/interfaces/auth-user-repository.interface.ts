import { AuthUser } from '../../entities/auth-user.entity';
import { RepositoryPort } from '@repo/shared';

// Definiujemy, jakie dodatkowe metody biznesowe ma nasze repozytorium,
// oprócz tych standardowych (save, delete itp.) z RepositoryPort
export interface IAuthUserRepository extends RepositoryPort<AuthUser, any> {
  findByEmail(email: string): Promise<AuthUser | null>;
}
