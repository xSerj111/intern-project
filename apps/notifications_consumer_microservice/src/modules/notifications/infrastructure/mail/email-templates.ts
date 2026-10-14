import type { EmailJob } from '@repo/shared';
import type { MailMessage } from '../../domain/interfaces/mailer.port';

export type RenderedEmail = Pick<MailMessage, 'subject' | 'text' | 'html'>;

const CALL_TO_ACTION: Record<EmailJob['kind'], string> = {
  NEW_MESSAGE: 'Open the conversation',
  POST_COMMENTED: 'View the comment',
  POST_LIKED: 'View your post',
  COMMENT_LIKED: 'View your comment',
  USER_FOLLOWED: 'View their profile',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders the plain-text and HTML body for an email job. The job already
 * carries the absolute `CLIENT_URL` deep link (post, profile or
 * `/messages/{chatId}`), the actor and the summary line.
 */
export function renderEmail(job: EmailJob): RenderedEmail {
  const action = CALL_TO_ACTION[job.kind];
  const excerpt = job.excerpt?.trim() ? job.excerpt.trim() : null;

  const textParts = [`Hi,`, '', job.summary];
  if (excerpt) {
    textParts.push('', `"${excerpt}"`);
  }
  textParts.push(
    '',
    `${action}: ${job.link}`,
    '',
    `You can change which emails you receive in your notification settings.`,
  );

  const html = [
    '<div style="font-family:Arial,sans-serif;font-size:15px;color:#1a1a1a">',
    `<p>Hi,</p>`,
    `<p>${escapeHtml(job.summary)}</p>`,
    excerpt
      ? `<blockquote style="margin:0 0 16px;padding-left:12px;border-left:3px solid #ccc;color:#555">${escapeHtml(excerpt)}</blockquote>`
      : '',
    `<p><a href="${escapeHtml(job.link)}">${escapeHtml(action)}</a></p>`,
    `<p style="color:#777;font-size:13px">You can change which emails you receive in your notification settings.</p>`,
    '</div>',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject: job.summary, text: textParts.join('\n'), html };
}
