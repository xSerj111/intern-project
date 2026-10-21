import path from 'node:path';

import { createSetupUser, loginInBrowser } from './fixtures/api';
import { expect, test } from './fixtures/test';

test('a post with an attached image shows a loaded image in the feed', async ({
  page,
}) => {
  const user = await createSetupUser('post-image');
  await loginInBrowser(page, user);

  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create new post' });
  await expect(dialog).toBeVisible();

  const caption = `image post ${user.username}`;
  await dialog.getByLabel('Post text').fill(caption);
  await dialog
    .locator('input[type="file"]')
    .setInputFiles(path.join(__dirname, 'fixtures', 'image.png'));
  await expect(dialog.getByText('1/10 photos')).toBeVisible();
  // Share stays disabled until the upload has finished.
  const share = dialog.getByRole('button', { name: 'Share', exact: true });
  await expect(share).toBeEnabled();
  await share.click();
  await expect(dialog).toBeHidden();

  const item = page.getByTestId('feed-item').filter({ hasText: caption });
  await expect(item).toBeVisible();
  const image = item.getByRole('img', { name: 'Photo 1 of 1' });
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
});
