import {
  createSetupUser,
  loginInBrowser,
  type SetupUser,
} from './fixtures/api';
import { expect, test } from './fixtures/test';

const CORE_URL = process.env.CORE_URL ?? 'http://localhost:3001';

/** Creates a post through the core API and publishes it; returns its id. */
async function createPublishedPost(
  author: SetupUser,
  content: string,
): Promise<string> {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${author.accessToken}`,
  };
  const created = await fetch(`${CORE_URL}/posts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content }),
  });
  if (!created.ok) {
    throw new Error(`POST /posts -> ${created.status} ${await created.text()}`);
  }
  const { id } = (await created.json()) as { id: string };
  const published = await fetch(`${CORE_URL}/posts/${id}/publish`, {
    method: 'POST',
    headers,
  });
  if (!published.ok) {
    throw new Error(
      `POST /posts/${id}/publish -> ${published.status} ${await published.text()}`,
    );
  }
  return id;
}

test('a reply renders inside its comment replies container', async ({
  page,
}) => {
  const author = await createSetupUser('comments');
  const stamp = Date.now().toString(36);
  const commentText = `comment ${stamp}`;
  const replyText = `reply ${stamp}`;
  const postId = await createPublishedPost(author, `post for ${stamp}`);

  await loginInBrowser(page, author);
  await page.goto(`/posts/${postId}`);

  await page.getByLabel('Add a comment').fill(commentText);
  await page.getByRole('button', { name: 'Post', exact: true }).click();

  const comment = page
    .getByTestId('comment-item')
    .filter({ hasText: commentText });
  await expect(comment).toBeVisible();

  await comment.getByRole('button', { name: 'Reply', exact: true }).click();
  await comment.getByLabel(/^Reply to /).fill(replyText);
  await comment
    .locator('form')
    .getByRole('button', { name: 'Reply', exact: true })
    .click();

  await expect(comment.getByTestId('comment-replies')).toContainText(replyText);
});
