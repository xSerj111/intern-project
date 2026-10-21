# client_app

Innogram web client (Next.js App Router).

## E2E

Browser tests use Playwright (Chromium only) and live in `e2e/`.

Prerequisites:

- The full stack and the client are already running (`npm run docker:up`, then `npm run dev`). The config has no `webServer`, so Playwright never starts anything.
- `CLIENT_URL` points at the client (default `http://localhost:3000`).
- Chromium is installed once with `npx playwright install chromium`.

Run from the repo root:

```bash
npm run e2e                       # all flows
npm run e2e -- --repeat-each=3    # flakiness check (SC-005)
npm run e2e -- --headed -g "chat" # pass any Playwright flag after `--`
```

Failed tests keep a trace and screenshot in `e2e/.artifacts/` (gitignored). Open a trace with:

```bash
npx playwright show-trace e2e/.artifacts/<test-dir>/trace.zip
```

The HTML report lands in `playwright-report/` (gitignored). A CI job for E2E is optional and not part of this feature's gates.
