import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import path from 'node:path';

const extensionPath = path.resolve('.output-e2e/chrome-mv3');

export const PAGE_URL = 'https://wordshift.test/page';

export const PAGE_HTML = `<!doctype html>
<html><head><title>Colour test</title></head>
<body>
  <h1>Colour guide</h1>
  <p id="p">The colour of the sea.</p>
  <textarea id="t">colour</textarea>
  <div id="spa"></div>
  <script>
    setTimeout(() => { document.getElementById('spa').innerHTML = '<p id="late">Late colour content</p>'; }, 400);
  </script>
</body></html>`;

export const test = base.extend<{ context: BrowserContext; sw: Worker; extensionId: string }>({
  // Playwright requires the object pattern even when no fixtures are used.
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await context.route('https://wordshift.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: PAGE_HTML }),
    );
    await use(context);
    await context.close();
  },
  sw: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    sw ??= await context.waitForEvent('serviceworker');
    await use(sw);
  },
  extensionId: async ({ sw }, use) => {
    await use(new URL(sw.url()).host);
  },
});

export { expect } from '@playwright/test';

export function rule(fields: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    groupId: null,
    enabled: true,
    replace: '',
    match: 'text',
    caseSensitive: false,
    sites: { include: [], exclude: [] },
    apply: { auto: true, manual: true },
    review: null,
    ...fields,
  };
}

export function library(rules: unknown[]) {
  return { format: 'wordshift', schemaVersion: 1, groups: [], rules };
}
