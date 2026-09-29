import { MAX_FILE_SIZE_BYTES, validateUploadFile } from './assets';

function file(name: string, type: string, size = 1024): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('validateUploadFile', () => {
  it('accepts supported images and videos', () => {
    expect(validateUploadFile(file('a.png', 'image/png'))).toBeNull();
    expect(validateUploadFile(file('a.mp4', 'video/mp4'))).toBeNull();
  });

  it('accepts a file exactly at the size limit', () => {
    expect(
      validateUploadFile(file('a.png', 'image/png', MAX_FILE_SIZE_BYTES)),
    ).toBeNull();
  });

  it('rejects files over 10 MB', () => {
    expect(
      validateUploadFile(file('big.png', 'image/png', 12 * 1024 * 1024)),
    ).toMatch(/larger than 10 MB/);
  });

  it('rejects unsupported types', () => {
    expect(validateUploadFile(file('a.pdf', 'application/pdf'))).toMatch(
      /image or video/,
    );
  });
});
