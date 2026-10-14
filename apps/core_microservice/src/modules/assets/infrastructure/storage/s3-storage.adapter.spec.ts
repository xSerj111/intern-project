import { buildAttachmentDisposition } from './s3-storage.adapter';

describe('buildAttachmentDisposition', () => {
  it('quotes a plain ASCII name and repeats it in filename*', () => {
    expect(buildAttachmentDisposition('report.pdf')).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
  });

  it('replaces non-ASCII characters in the fallback and percent-encodes filename*', () => {
    const header = buildAttachmentDisposition('zdjęcie.pdf');

    expect(header).toContain('filename="zdj_cie.pdf"');
    expect(header).toContain(`filename*=UTF-8''zdj%C4%99cie.pdf`);
  });

  it('escapes quotes and backslashes in the fallback', () => {
    const header = buildAttachmentDisposition('a"b\\c.txt');

    expect(header).toContain('filename="a\\"b\\\\c.txt"');
  });

  it("percent-encodes ' ( ) * in filename*", () => {
    const header = buildAttachmentDisposition("it's (a)*.txt");

    expect(header).toContain(`filename*=UTF-8''it%27s%20%28a%29%2A.txt`);
  });
});
