import { UPLOAD_ALLOWLIST } from '@repo/contracts';
import { FileTypeContentSniffer } from './file-type-content-sniffer';

// Plain Jest cannot load the ESM-only `file-type` that Nest's validator
// imports, so a minimal magic-number detector stands in for it.
const SIGNATURES: [string, number[]][] = [
  ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/gif', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
  ['application/pdf', [0x25, 0x50, 0x44, 0x46, 0x2d]],
  ['application/x-msdownload', [0x4d, 0x5a]],
];

jest.mock('load-esm', () => ({
  loadEsm: () =>
    Promise.resolve({
      fileTypeFromBuffer: (buf: Buffer) => {
        const isWebp =
          buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
          buf.subarray(8, 12).toString('latin1') === 'WEBP';
        if (isWebp) return Promise.resolve({ mime: 'image/webp', ext: 'webp' });
        const hit = SIGNATURES.find(([, sig]) =>
          sig.every((byte, i) => buf[i] === byte),
        );
        return Promise.resolve(hit && { mime: hit[0], ext: '' });
      },
    }),
}));

const bytes = (...b: number[]) => Buffer.from(b);
const PNG = bytes(...SIGNATURES[0][1], 0, 0, 0, 13);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16);
const GIF = bytes(...SIGNATURES[2][1], 1, 0, 1, 0);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  bytes(0, 0, 0, 0),
  Buffer.from('WEBPVP8 '),
]);
const PDF = Buffer.from('%PDF-1.7\n');
const EXE = Buffer.concat([Buffer.from('MZ'), bytes(0x90, 0, 3, 0)]);

describe('FileTypeContentSniffer', () => {
  const sniffer = new FileTypeContentSniffer();

  it.each([
    ['image/jpeg', JPEG],
    ['image/png', PNG],
    ['image/webp', WEBP],
    ['image/gif', GIF],
  ])(
    'accepts %s for post-image and returns the detected type',
    async (mime, head) => {
      await expect(sniffer.detect(head, mime, 'post-image')).resolves.toEqual({
        allowed: true,
        detectedMime: mime,
      });
    },
  );

  it('returns the detected mime, not the declared one', async () => {
    await expect(sniffer.detect(PNG, 'image/jpeg', 'avatar')).resolves.toEqual({
      allowed: true,
      detectedMime: 'image/png',
    });
  });

  it('rejects EXE bytes declared as image/png', async () => {
    await expect(
      sniffer.detect(EXE, 'image/png', 'post-image'),
    ).resolves.toEqual({
      allowed: false,
    });
  });

  it('rejects SVG and HTML, declared as images or text', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const html = Buffer.from('<!DOCTYPE html><html><script>1</script></html>');
    for (const [head, mime] of [
      [svg, 'image/svg+xml'],
      [svg, 'image/png'],
      [html, 'text/html'],
      [html, 'image/png'],
      [svg, 'text/plain'],
      [html, 'text/plain'],
    ] as const) {
      await expect(
        sniffer.detect(head, mime, 'chat-attachment'),
      ).resolves.toEqual({ allowed: false });
    }
  });

  it('keeps SVG out of every allowlist', () => {
    for (const list of Object.values(UPLOAD_ALLOWLIST)) {
      expect(list).not.toContain('image/svg+xml');
    }
  });

  it('accepts a PDF for chat-attachment only', async () => {
    await expect(
      sniffer.detect(PDF, 'application/pdf', 'chat-attachment'),
    ).resolves.toEqual({ allowed: true, detectedMime: 'application/pdf' });
    await expect(
      sniffer.detect(PDF, 'application/pdf', 'post-image'),
    ).resolves.toEqual({ allowed: false });
  });

  it('accepts UTF-8 plain and CSV text with the declared type', async () => {
    const text = Buffer.from('name,city\nZoë,Łódź\n');
    await expect(
      sniffer.detect(text, 'text/csv', 'chat-attachment'),
    ).resolves.toEqual({ allowed: true, detectedMime: 'text/csv' });
    await expect(
      sniffer.detect(text, 'text/plain', 'chat-attachment'),
    ).resolves.toEqual({ allowed: true, detectedMime: 'text/plain' });
  });

  it('tolerates a multibyte character cut at the end of the head', async () => {
    const cut = Buffer.from('zażółć').subarray(0, -1);
    await expect(
      sniffer.detect(cut, 'text/plain', 'chat-attachment'),
    ).resolves.toMatchObject({ allowed: true });
  });

  it('rejects text with a NUL byte or invalid UTF-8', async () => {
    await expect(
      sniffer.detect(Buffer.from('a\0b'), 'text/plain', 'chat-attachment'),
    ).resolves.toEqual({ allowed: false });
    await expect(
      sniffer.detect(
        bytes(0x61, 0xff, 0xfe, 0x62),
        'text/csv',
        'chat-attachment',
      ),
    ).resolves.toEqual({ allowed: false });
  });

  it('rejects text for purposes that do not allow it', async () => {
    await expect(
      sniffer.detect(Buffer.from('hello'), 'text/plain', 'post-image'),
    ).resolves.toEqual({ allowed: false });
  });

  it('rejects an empty head and unknown purposes', async () => {
    await expect(
      sniffer.detect(Buffer.alloc(0), 'image/png', 'post-image'),
    ).resolves.toEqual({ allowed: false });
    await expect(
      sniffer.detect(PNG, 'image/png', 'nope' as never),
    ).resolves.toEqual({ allowed: false });
  });
});
