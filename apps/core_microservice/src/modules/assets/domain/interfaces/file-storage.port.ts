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
}
