import { FileTypeValidator, Injectable } from '@nestjs/common';
import { UPLOAD_ALLOWLIST, type UploadPurpose } from '@repo/contracts';
import type {
  ContentSniffResult,
  IContentSniffer,
} from '../../domain/interfaces/content-sniffer.port';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Markup that must never pass as a text attachment (SVG, XML, HTML); `\s` also skips a BOM. */
const MARKUP_START = /^\s*<(\?xml|svg|!doctype\s+html|html)\b/i;

const isText = (mime: string) => mime.startsWith('text/');

/** Valid UTF-8 without NUL; a multibyte char cut by the head limit is fine. */
function isCleanUtf8(head: Buffer): boolean {
  if (head.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });
  } catch {
    return false;
  }
  return !MARKUP_START.test(head.toString('utf8', 0, 256));
}

/**
 * Magic-number content check built on Nest's `FileTypeValidator`, the same
 * mechanism and allowlist as `chats/attachments.controller.ts`. Unlike that
 * pipe, the declared type is a fallback only for text types (which have no
 * magic number): a binary type whose bytes are not recognised is rejected,
 * so HTML declared as `image/png` does not pass.
 */
@Injectable()
export class FileTypeContentSniffer implements IContentSniffer {
  async detect(
    head: Buffer,
    declaredMime: string,
    purpose: UploadPurpose,
  ): Promise<ContentSniffResult> {
    const allowlist = UPLOAD_ALLOWLIST[purpose];
    const declared = declaredMime.trim().toLowerCase();
    if (!allowlist || !allowlist.includes(declared) || head.length === 0) {
      return { allowed: false };
    }

    const file = { buffer: head, mimetype: declared, size: head.length };
    const validator = new FileTypeValidator({
      fileType: new RegExp(`^(${allowlist.map(escapeRegExp).join('|')})$`),
      fallbackToMimetype: isText(declared),
      overrideMimeType: true,
    });

    if (!(await validator.isValid(file))) return { allowed: false };
    if (isText(file.mimetype) && !isCleanUtf8(head)) return { allowed: false };
    return { allowed: true, detectedMime: file.mimetype };
  }
}
