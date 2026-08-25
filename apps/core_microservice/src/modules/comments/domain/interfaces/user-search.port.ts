export const UserSearchPortKey = Symbol.for('IUserSearchPort');

export interface IUserSearchPort {
  // Przyjmuje tablice nazw (np. ['jan_kowalski', 'anna_nowak'])
  // Zwraca tablice obiektow z ich ID
  getUsersIdsByHandles(
    handles: string[],
  ): Promise<{ id: string; handle: string }[]>;
}
