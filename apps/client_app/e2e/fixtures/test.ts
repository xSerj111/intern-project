import { test as base, expect, type BrowserContext } from '@playwright/test';

interface Fixtures {
  /**
   * Starts collecting console errors and uncaught page errors for a context
   * created by hand (`browser.newContext()`); the test's own `context` is
   * already covered by the auto fixture below.
   */
  trackErrors: (context: BrowserContext) => void;
  errorCollector: string[];
  watchDefaultContext: void;
}

export const test = base.extend<Fixtures>({
  errorCollector: async ({}, use, testInfo) => {
    const errors: string[] = [];
    await use(errors);
    if (errors.length > 0 && testInfo.status === testInfo.expectedStatus) {
      throw new Error(
        `Browser reported ${errors.length} error(s):\n${errors
          .map((e) => `  - ${e}`)
          .join('\n')}`,
      );
    }
  },

  trackErrors: async ({ errorCollector }, use) => {
    await use((context) => {
      context.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const { url } = msg.location();
        errorCollector.push(
          `console.error: ${msg.text()}${url ? ` (${url})` : ''}`,
        );
      });
      context.on('weberror', (webError) => {
        errorCollector.push(`pageerror: ${webError.error().message}`);
      });
    });
  },

  // Auto: every test gets error collection without asking for it.
  watchDefaultContext: [
    async ({ context, trackErrors }, use) => {
      trackErrors(context);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
