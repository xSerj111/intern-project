import type { EmailJob } from '@repo/shared';
import { renderEmail } from './email-templates';

const job = (overrides: Partial<EmailJob> = {}): EmailJob => ({
  jobId: 'evt:user',
  recipientId: 'user',
  kind: 'POST_COMMENTED',
  actor: {
    userId: 'actor',
    username: 'anna',
    displayName: 'Anna',
    avatarUrl: null,
  },
  link: 'http://localhost:3000/posts/p1',
  summary: 'Anna commented on your post',
  excerpt: 'Nice one!',
  ...overrides,
});

describe('renderEmail', () => {
  it('renders summary, excerpt and link in text and html', () => {
    const mail = renderEmail(job());

    expect(mail.subject).toBe('Anna commented on your post');
    expect(mail.text).toContain('Anna commented on your post');
    expect(mail.text).toContain('"Nice one!"');
    expect(mail.text).toContain('http://localhost:3000/posts/p1');
    expect(mail.html).toContain('href="http://localhost:3000/posts/p1"');
    expect(mail.html).toContain('Nice one!');
  });

  it('omits the excerpt block when there is none', () => {
    const mail = renderEmail(job({ kind: 'USER_FOLLOWED', excerpt: null }));

    expect(mail.html).not.toContain('blockquote');
    expect(mail.text).toContain('View their profile');
  });

  it('escapes html in user-supplied text', () => {
    const mail = renderEmail(
      job({ summary: '<b>x</b> & co', excerpt: '<script>alert(1)</script>' }),
    );

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; co');
  });

  it('links a new-message email to the conversation', () => {
    const mail = renderEmail(
      job({
        kind: 'NEW_MESSAGE',
        link: 'http://localhost:3000/messages/c1',
        summary: 'Anna sent you a message',
      }),
    );

    expect(mail.text).toContain(
      'Open the conversation: http://localhost:3000/messages/c1',
    );
  });
});
