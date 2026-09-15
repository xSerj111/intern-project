export interface ICryptoService {
  hash(data: string, saltOrRounds?: number): Promise<string>;
  compare(data: string, encrypted: string): Promise<boolean>;
}
