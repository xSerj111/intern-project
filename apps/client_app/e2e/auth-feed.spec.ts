import { expect, test } from './fixtures/test';
import { uniqueUser } from './fixtures/run-id';

test('signs up and logs in through the UI and lands on a rendered feed', async ({
  page,
}) => {
  const user = uniqueUser('auth-feed');

  await page.goto('/signup');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();

  await expect(page).toHaveURL((url) => url.pathname === '/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page).toHaveURL((url) => url.pathname === '/');
  const feed = page.getByRole('region', { name: 'Home feed' });
  await expect(feed).toBeVisible();
  // A brand-new user follows nobody, so the feed settles on its empty state.
  await expect(
    feed.getByRole('heading', { name: 'Follow people to fill your feed' }),
  ).toBeVisible();
  await expect(feed.getByRole('alert')).toHaveCount(0);
});
