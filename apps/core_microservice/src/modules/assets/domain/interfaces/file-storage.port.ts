export const FileStoragePortKey = Symbol.for('IFileStoragePort');

export interface IFileStoragePort {
  /**
   * Zapisuje plik w magazynie obiektów i zwraca jego publiczny adres URL.
   *
   * @param file Bufor zawierający dane binarne pliku
   * @param filename Oryginalna nazwa pliku (np. "zdjecie.png")
   * @param mimeType Typ MIME pliku (np. "image/png")
   * @returns Publiczny URL do zapisanego pliku
   */
  upload(file: Buffer, filename: string, mimeType: string): Promise<string>;

  /**
   * Zapisuje plik w prywatnym buckecie pod podanym kluczem. Nie zwraca
   * publicznego adresu URL; dostęp tylko przez {@link presignGet}.
   */
  uploadPrivate(file: Buffer, key: string, mimeType?: string): Promise<void>;

  /**
   * Zwraca krótkotrwały podpisany URL GET do obiektu z prywatnego bucketu.
   * Z `downloadName` ustawia `Content-Disposition: attachment`.
   */
  presignGet(
    key: string,
    options: { ttlSeconds: number; downloadName?: string },
  ): Promise<string>;

  /** Usuwa obiekt z prywatnego bucketu. */
  delete(key: string): Promise<void>;
}
