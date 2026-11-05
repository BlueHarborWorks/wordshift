import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ARTICLE_URL, demoLibrary, expect, test } from './fixtures';

/*
 * Chrome Web Store images: 1280x800 screenshots and the 440x280 small promo tile, all opaque PNG.
 * Runs only when WORDSHIFT_STORE names an output folder:
 *   WORDSHIFT_STORE=store/chrome npm run e2e -- store
 */
const OUT = process.env.WORDSHIFT_STORE;
test.skip(!OUT, 'Set WORDSHIFT_STORE to an output folder to capture store images.');

const out = (name: string) => path.join(OUT ?? '', name);
const STORE = { width: 1280, height: 800 };

test('capture Chrome Web Store images', async ({ context, extensionId, sw }) => {
  // 1. Quick Replace: the toolbar popup over a page, with matches highlighted.
  const page = await context.newPage();
  await page.setViewportSize(STORE);
  await page.goto(ARTICLE_URL);
  // Leave room on the right for the popup, where Chrome anchors it under the toolbar button.
  await page.addStyleTag({ content: 'header, article { zoom: 1.2; } article { margin: 40px 0 0 40px; }' });
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]!.id!, ARTICLE_URL);

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 364, height: 330 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  await popup.getByPlaceholder('Find').fill('colour');
  await popup.getByPlaceholder('Replace with').fill('color');
  await popup.getByRole('radio', { name: 'Whole word' }).click();
  await expect(popup.locator('#find-status')).toHaveText('1 of 5');
  await popup.getByPlaceholder('Find').press('Enter');
  await expect(popup.locator('#find-status')).toHaveText('2 of 5');
  // Show the whole popup, as Chrome sizes it to its content.
  await popup.setViewportSize({ width: 364, height: await popup.evaluate(() => document.body.scrollHeight) });
  await popup.waitForTimeout(200);
  const popupPng = (await popup.screenshot()).toString('base64');

  await page.evaluate((src) => {
    const img = document.createElement('img');
    img.src = `data:image/png;base64,${src}`;
    img.alt = '';
    img.style.cssText =
      'position:fixed;top:8px;right:24px;width:364px;border:1px solid rgba(0,0,0,.14);' +
      'border-radius:8px;box-shadow:0 10px 32px rgba(0,0,0,.22);';
    document.body.append(img);
    return img.decode();
  }, popupPng);
  // Highlights stay on the page only while the popup is open.
  await page.screenshot({ path: out('screenshot-1-quick-replace.png') });
  await popup.close();
  await page.close();

  // 2-3. Rule Library, light and dark.
  await sw.evaluate((lib) => chrome.storage.local.set({ library: lib }), demoLibrary());
  const library = await context.newPage();
  await library.setViewportSize(STORE);
  for (const [n, scheme] of [
    [2, 'light'],
    [3, 'dark'],
  ] as const) {
    await library.emulateMedia({ colorScheme: scheme });
    await library.goto(`chrome-extension://${extensionId}/options.html`);
    await library.getByText('organise', { exact: true }).click();
    await expect(library.getByRole('form', { name: 'Edit rule' })).toBeVisible();
    await library.waitForTimeout(300);
    await library.screenshot({ path: out(`screenshot-${n}-rule-library-${scheme}.png`) });
  }
  await library.close();

  // Small promo tile.
  const icon = readFileSync(path.resolve('assets-src/icon.svg'), 'utf8');
  const tile = await context.newPage();
  await tile.setViewportSize({ width: 440, height: 280 });
  await tile.setContent(`<!doctype html><html><body style="margin:0">
    <div style="box-sizing:border-box;width:440px;height:280px;padding:40px 36px;display:flex;flex-direction:column;
      justify-content:center;gap:18px;background:#f7f7f6;color:#1c1c1b;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
      <div style="display:flex;align-items:center;gap:16px">
        <div style="width:64px;height:64px">${icon.replace('<svg ', '<svg width="64" height="64" ')}</div>
        <div style="font-size:36px;font-weight:650;letter-spacing:-.01em">Wordshift</div>
      </div>
      <div style="font-size:19px;line-height:1.35;color:#3b3b39">Find and replace text on web pages, in one tab or by rules you control.</div>
    </div></body></html>`);
  await tile.screenshot({ path: out('promo-small-440x280.png') });
  await tile.close();
});
