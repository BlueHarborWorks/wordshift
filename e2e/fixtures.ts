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

export const ARTICLE_URL = 'https://wordshift.test/article';

export const ARTICLE_HTML = `<!doctype html>
<html><head><title>Notes on harbour colour</title>
<style>
  body { margin: 0; font: 17px/1.6 Georgia, serif; color: #222; background: #fff; }
  header { padding: 14px 40px; border-bottom: 1px solid #e5e5e5; font: 600 14px system-ui, sans-serif; color: #555; }
  article { max-width: 620px; margin: 36px auto; padding: 0 24px; }
  h1 { font-size: 34px; line-height: 1.2; margin: 0 0 8px; }
  .by { font: 14px system-ui, sans-serif; color: #777; margin-bottom: 24px; }
</style></head>
<body>
  <header>The Harbour Journal</header>
  <article>
    <h1>The colour of a working harbour</h1>
    <p class="by">Field notes, October</p>
    <p>At first light the water takes its colour from the cranes: grey steel, then a thin band of orange as the sun clears the breakwater. By mid-morning the colour shifts again, and the hulls set the tone.</p>
    <p>Painters who work here learn to mix a colour quickly. The light changes faster than the tide, and the colour you saw a minute ago is already gone.</p>
  </article>
</body></html>`;

export const test = base.extend<{ context: BrowserContext; sw: Worker; extensionId: string }>({
  // Playwright requires the object pattern even when no fixtures are used.
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      deviceScaleFactor: process.env.WORDSHIFT_SHOTS ? 2 : 1,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await context.route('https://wordshift.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: route.request().url() === ARTICLE_URL ? ARTICLE_HTML : PAGE_HTML,
      }),
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
    review: null,
    ...fields,
  };
}

export function library(rules: unknown[]) {
  return { format: 'wordshift', schemaVersion: 2, groups: [], rules };
}
