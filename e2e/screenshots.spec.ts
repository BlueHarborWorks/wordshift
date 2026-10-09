import path from 'node:path';
import { ARTICLE_URL, expect, test } from './fixtures';

/*
 * Product screenshots for the landing page. Runs only when WORDSHIFT_SHOTS names an output folder:
 *   WORDSHIFT_SHOTS=site/img npm run e2e -- screenshots
 */
const SHOTS = process.env.WORDSHIFT_SHOTS;
test.skip(!SHOTS, 'Set WORDSHIFT_SHOTS to an output folder to capture screenshots.');

const shot = (name: string) => path.join(SHOTS ?? '', name);

const demoLibrary = () => {
  const spelling = crypto.randomUUID();
  const work = crypto.randomUUID();
  const rule = (groupId: string | null, fields: Record<string, unknown>) => ({
    id: crypto.randomUUID(),
    groupId,
    enabled: true,
    replace: '',
    match: 'text',
    caseSensitive: false,
    sites: { include: [], exclude: [] },
    apply: { auto: true, manual: true },
    review: null,
    ...fields,
  });
  return {
    format: 'wordshift',
    schemaVersion: 1,
    groups: [
      { id: spelling, name: 'British to American', enabled: true },
      { id: work, name: 'Work', enabled: true },
    ],
    rules: [
      rule(spelling, { find: 'colour', replace: 'color', match: 'word' }),
      rule(spelling, { find: 'harbour', replace: 'harbor', match: 'word' }),
      rule(spelling, { find: 'organise', replace: 'organize', match: 'word' }),
      rule(spelling, {
        find: 'centre',
        replace: 'center',
        match: 'word',
        sites: { include: [], exclude: ['bbc.co.uk'] },
      }),
      rule(work, {
        find: 'PRJ-(\\d+)',
        replace: 'Ticket $1',
        match: 'regex',
        caseSensitive: true,
        sites: { include: ['tracker.example.com'], exclude: [] },
      }),
      rule(work, {
        find: 'Q4 planning',
        replace: 'Q4 roadmap',
        sites: { include: ['docs.example.com'], exclude: [] },
        apply: { auto: false, manual: true },
      }),
      rule(null, { find: 'e-mail', replace: 'email', match: 'word' }),
    ],
  };
};

test('capture landing page screenshots', async ({ context, extensionId, sw }) => {
  for (const scheme of ['light', 'dark'] as const) {
    const page = await context.newPage();
    await page.setViewportSize({ width: 860, height: 520 });
    await page.goto(ARTICLE_URL);
    const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]!.id!, ARTICLE_URL);

    const popup = await context.newPage();
    await popup.emulateMedia({ colorScheme: scheme });
    await popup.setViewportSize({ width: 364, height: 330 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
    await popup.getByPlaceholder('Find').fill('colour');
    await popup.getByPlaceholder('Replace with').fill('color');
    await popup.getByRole('radio', { name: 'Word' }).click();
    await expect(popup.locator('#find-status')).toHaveText('1 of 5');
    await popup.getByPlaceholder('Find').press('Enter');
    await expect(popup.locator('#find-status')).toHaveText('2 of 5');
    await popup.waitForTimeout(200);
    await popup.screenshot({ path: shot(`popup-${scheme}.png`) });
    if (scheme === 'light') await page.screenshot({ path: shot('page-highlights.png') });
    await popup.close();
    await page.close();
  }

  await sw.evaluate((lib) => chrome.storage.local.set({ library: lib }), demoLibrary());
  const library = await context.newPage();
  await library.setViewportSize({ width: 1120, height: 600 });
  for (const scheme of ['light', 'dark'] as const) {
    await library.emulateMedia({ colorScheme: scheme });
    await library.goto(`chrome-extension://${extensionId}/options.html`);
    await library.getByText('organise', { exact: true }).click();
    await expect(library.getByRole('form', { name: 'Edit rule' })).toBeVisible();
    await library.waitForTimeout(300);
    await library.screenshot({ path: shot(`library-${scheme}.png`) });
  }
});
