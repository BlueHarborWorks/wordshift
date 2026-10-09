import path from 'node:path';
import { expect, library, PAGE_URL, rule, test } from './fixtures';

const SHOTS = process.env.WORDSHIFT_SHOTS;

async function waitForRegistration(sw: import('@playwright/test').Worker, expected: number) {
  await expect
    .poll(() => sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length))
    .toBe(expected);
}

test('automatic rules change page text, follow new content, and undo when paused', async ({ context, sw }) => {
  await sw.evaluate(
    (lib) => chrome.storage.local.set({ library: lib }),
    library([rule({ find: 'colour', replace: 'color', match: 'word' })]),
  );
  await waitForRegistration(sw, 1);

  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await expect(page.locator('h1')).toHaveText('color guide');
  await expect(page.locator('#p')).toHaveText('The color of the sea.');
  await expect(page).toHaveTitle('color test');
  await expect(page.locator('#t')).toHaveValue('colour');
  await expect(page.locator('#late')).toHaveText('Late color content');

  await sw.evaluate(() => chrome.storage.local.set({ settings: { autoApply: true, pausedSites: ['wordshift.test'] } }));
  await expect(page.locator('h1')).toHaveText('Colour guide');
  await expect(page.locator('#late')).toHaveText('Late colour content');
});

test('no content script is registered without automatic rules', async ({ sw }) => {
  await sw.evaluate(
    (lib) => chrome.storage.local.set({ library: lib }),
    library([rule({ find: 'a', replace: 'b', apply: { auto: false, manual: true } })]),
  );
  await waitForRegistration(sw, 0);
});

test('Quick Replace finds, replaces all, and undoes', async ({ context, extensionId, sw }) => {
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]!.id!, PAGE_URL);

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 364, height: 420 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);

  await expect(page.locator('#late')).toBeVisible();
  await popup.getByPlaceholder('Find').fill('colour');
  // Title, heading, paragraph, and the late-loading paragraph; not the textarea.
  await expect(popup.locator('#find-status')).toHaveText('1 of 4');
  await popup.getByPlaceholder('Replace with').fill('hue');
  await popup.getByPlaceholder('Find').press('Enter');
  await expect(popup.locator('#find-status')).toHaveText('2 of 4');
  if (SHOTS) await popup.screenshot({ path: path.join(SHOTS, 'popup-light.png') });

  await popup.getByRole('button', { name: 'Replace all' }).click();
  await expect(page.locator('h1')).toHaveText('hue guide');
  await expect(page.locator('#p')).toHaveText('The hue of the sea.');
  await expect(popup.locator('#find-status')).toHaveText('No matches');

  await popup.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('h1')).toHaveText('Colour guide');

  await popup.getByPlaceholder('Find').fill('(unclosed');
  await popup.getByRole('radio', { name: 'Regex' }).click();
  await expect(popup.getByRole('alert')).toBeVisible();

  await popup.emulateMedia({ colorScheme: 'dark' });
  await popup.getByPlaceholder('Find').fill('sea');
  await popup.getByRole('radio', { name: 'Text' }).click();
  await expect(popup.locator('#find-status')).toHaveText('1 of 1');
  if (SHOTS) await popup.screenshot({ path: path.join(SHOTS, 'popup-dark.png') });
});

test('Rule Library creates rules and imports FoxReplace files', async ({ context, extensionId, sw }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(page.getByText('No rules yet.')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'library-empty.png') });

  await page.getByRole('button', { name: 'New rule' }).click();
  await page.getByLabel('Find').fill('teh');
  await page.getByLabel('Replace with').fill('the');
  await page.getByRole('radio', { name: 'Word' }).click();
  await page.getByLabel('Try it').fill('teh cat sat on tehm');
  await expect(page.getByText('the cat sat on tehm')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'library-editor.png') });
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.locator('.rule-list li')).toHaveCount(1);
  const stored = await sw.evaluate(async () => (await chrome.storage.local.get('library')).library);
  expect(stored.rules[0]).toMatchObject({ find: 'teh', replace: 'the', match: 'word' });

  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('File').setInputFiles(path.resolve('test/fixtures/foxreplace-2.6.json'));
  await expect(page.getByText('from a FoxReplace file')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'library-import.png') });
  await page.getByRole('button', { name: 'Add to my rules' }).click();

  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('button', { name: 'Needs review 2' })).toBeVisible();
  await nav.getByRole('button', { name: /All rules/ }).click();
  await expect(page.locator('.rule-list li')).toHaveCount(7);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'library-list.png') });

  await page.emulateMedia({ colorScheme: 'dark' });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'library-list-dark.png') });

  await page.getByRole('button', { name: 'Settings' }).click();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'library-settings.png') });
});
