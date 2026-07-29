import bcrypt from 'bcrypt';
import { ICryptoService } from '../../domain/interfaces/crypto.service.interface';

export class BcryptService implements ICryptoService {
  constructor(private readonly defaultSaltRounds: number = 10) {}

  async hash(data: string, saltOrRounds?: number): Promise<string> {
    const rounds = saltOrRounds || this.defaultSaltRounds;
    return bcrypt.hash(data, rounds);
  }

  async compare(data: string, encrypted: string): Promise<boolean> {
    return bcrypt.compare(data, encrypted);
  }
}
