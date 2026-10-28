import { AuthUser } from '../entities/auth-user.entity';
import { RepositoryPort } from '@repo/shared';

// Definiujemy, jakie dodatkowe metody biznesowe ma nasze repozytorium,
// in addition to the standard ones (save, delete, etc.) from RepositoryPort
export interface IAuthUserRepository extends RepositoryPort<AuthUser, any> {
  findByEmail(email: string): Promise<AuthUser | null>;
}
