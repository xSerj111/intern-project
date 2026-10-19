/** Small in-memory files for the attachment e2e specs (magic numbers are real). */

/** A valid 1x1 transparent PNG. */
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** A minimal one-page PDF (header, body and trailer are enough for detection). */
export const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);

export const TXT_BYTES = Buffer.from('hello attachments\n', 'utf8');

/** A DOS/PE stub: starts with `MZ`, which file-type reports as application/x-msdownload. */
export const EXE_BYTES = Buffer.concat([
  Buffer.from('MZ', 'latin1'),
  Buffer.alloc(62, 0),
  Buffer.from('This program cannot be run in DOS mode.', 'latin1'),
]);

/** Distinct bytes per call, so downloads can be matched to the right upload. */
export const uniqueBytes = (base: Buffer, tag: string): Buffer =>
  Buffer.concat([base, Buffer.from(`\n<!-- ${tag} -->`, 'utf8')]);
