import {
  createDirectChat,
  createSetupUser,
  loginInBrowser,
} from './fixtures/api';
import { expect, test } from './fixtures/test';

test('a message sent by A appears for B without a reload', async ({
  browser,
  trackErrors,
}) => {
  const userA = await createSetupUser('chat-a');
  const userB = await createSetupUser('chat-b');
  const chatId = await createDirectChat(userA, userB);
  const text = `hello ${Date.now().toString(36)}`;

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  trackErrors(contextA);
  trackErrors(contextB);

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await loginInBrowser(pageA, userA);
    await loginInBrowser(pageB, userB);

    // B opens the chat first and stays on it; it must never reload.
    await pageB.goto(`/messages/${chatId}`);
    await expect(pageB.getByRole('textbox', { name: 'Message' })).toBeVisible();

    await pageA.goto(`/messages/${chatId}`);
    const composer = pageA.getByRole('textbox', { name: 'Message' });
    await expect(composer).toBeEnabled();
    await composer.fill(text);
    await pageA.getByRole('button', { name: 'Send message' }).click();

    await expect(
      pageB.getByTestId('message-bubble').filter({ hasText: text }),
    ).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
