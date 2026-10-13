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

test('no content script is registered without enabled rules', async ({ sw }) => {
  await sw.evaluate(
    (lib) => chrome.storage.local.set({ library: lib }),
    library([rule({ find: 'a', replace: 'b', enabled: false })]),
  );
  await waitForRegistration(sw, 0);
});

test('popup explains when a matching group is off and turns it on', async ({ context, extensionId, sw }) => {
  const groupId = crypto.randomUUID();
  await sw.evaluate((lib) => chrome.storage.local.set({ library: lib }), {
    ...library([]),
    groups: [{ id: groupId, name: 'Site terms', enabled: false }],
    rules: [rule({ groupId, find: 'colour', replace: 'color', match: 'word' })],
  });

  const page = await context.newPage();
  await page.goto(PAGE_URL);
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]!.id!, PAGE_URL);
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 364, height: 520 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);

  await expect(popup.getByText('Needs attention')).toBeVisible();
  await expect(popup.getByText('“Site terms” group is off.')).toBeVisible();
  await popup.getByRole('button', { name: 'Turn on group' }).click();

  await expect(page.locator('h1')).toHaveText('color guide');
  await expect(popup.getByText('Active', { exact: true })).toHaveCSS('color', 'rgb(35, 122, 69)');
  await expect(popup.getByText(/automatic rule.*changes here/)).toHaveCSS('color', 'rgb(35, 122, 69)');
  await expect.poll(() => sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)).toBe('•');
  const pause = popup.getByRole('button', { name: 'Pause automatic rules' });
  await expect(pause).toHaveCSS('border-top-style', 'solid');
  await pause.click();
  await expect(popup.getByText('Automatic rules paused')).toBeVisible();
  await expect(popup.getByText('Quick Replace above still works.')).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Resume automatic rules' })).toBeVisible();
  await expect.poll(() => sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)).toBe('');
  const stored = await sw.evaluate(async () => (await chrome.storage.local.get('library')).library);
  expect(stored.groups[0].enabled).toBe(true);
});

test('Quick Replace finds, replaces all, and undoes', async ({ context, extensionId, sw }) => {
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]!.id!, PAGE_URL);

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 364, height: 420 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);

  await expect(page.locator('#late')).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Open Rule Library' })).toHaveCSS('border-top-style', 'solid');
  await expect(popup.getByText('This tab', { exact: true })).toBeVisible();
  await expect(popup.getByText(/Stays active in this tab.*reapplies after reloads/)).toBeVisible();
  await popup.getByPlaceholder('Find').fill('colour');
  await expect(popup.getByRole('button', { name: 'Match case' })).toBeVisible();
  // Heading, paragraph, and the late-loading paragraph; not the textarea or the tab title.
  await expect(popup.locator('#find-status')).toHaveText('1 of 3');
  await popup.getByPlaceholder('Replace with').fill('hue');
  await popup.getByPlaceholder('Find').press('Enter');
  await expect(popup.locator('#find-status')).toHaveText('2 of 3');
  if (SHOTS) await popup.screenshot({ path: path.join(SHOTS, 'popup-light.png') });

  await popup.getByRole('button', { name: 'Replace all' }).click();
  await expect(page.locator('h1')).toHaveText('hue guide');
  await expect(page.locator('#p')).toHaveText('The hue of the sea.');
  await expect(popup.locator('#find-status')).toHaveText('No matches');
  await expect(popup.getByText(/on-demand|manual-only/i)).toHaveCount(0);
  const quickActive = popup.getByText('Quick changes active in this tab');
  await expect(quickActive).toBeVisible();
  await expect(quickActive).toHaveCSS('color', 'rgb(35, 122, 69)');
  await expect(popup.getByText('1 action')).toBeVisible();
  await expect(popup.getByText('colour', { exact: true })).toBeVisible();
  await expect(popup.getByText('hue', { exact: true })).toBeVisible();

  // A second action can remain active while the first one is removed individually.
  await popup.getByPlaceholder('Find').fill('sea');
  await popup.getByPlaceholder('Replace with').fill('ocean');
  await popup.getByRole('button', { name: 'Replace all' }).click();
  await expect(page.locator('#p')).toHaveText('The hue of the ocean.');
  await expect(popup.getByText('2 actions')).toBeVisible();
  await popup.getByRole('button', { name: 'Remove Quick change colour to hue' }).click();
  await expect(page.locator('h1')).toHaveText('Colour guide');
  await expect(page.locator('#p')).toHaveText('The colour of the ocean.');
  await expect(popup.getByText('1 action')).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Remove Quick change colour to hue' })).toHaveCount(0);

  // Active Quick changes survive a reload and are reapplied automatically in this tab.
  await page.reload();
  await expect(page.locator('#p')).toHaveText('The colour of the ocean.');
  await popup.reload();
  await expect(popup.getByText('Quick changes active in this tab')).toBeVisible();
  await expect(popup.getByText('sea', { exact: true })).toBeVisible();
  await expect.poll(() => sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)).toBe('•');

  await popup.getByRole('button', { name: 'Undo last' }).click();
  await expect(page.locator('h1')).toHaveText('Colour guide');
  await expect(page.locator('#p')).toHaveText('The colour of the sea.');
  await expect(popup.getByText('Quick changes active in this tab')).toHaveCount(0);
  await expect.poll(() => sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)).toBe('');

  await popup.getByPlaceholder('Find').fill('(unclosed');
  await popup.getByRole('radio', { name: 'Regex' }).click();
  await expect(popup.getByRole('alert')).toBeVisible();

  await popup.emulateMedia({ colorScheme: 'dark' });
  await popup.getByPlaceholder('Find').fill('sea');
  await popup.getByRole('radio', { name: 'Anywhere' }).click();
  await expect(popup.locator('#find-status')).toHaveText('1 of 1');
  await popup.getByRole('button', { name: 'Clear search' }).click();
  await expect(popup.getByPlaceholder('Find')).toHaveValue('');
  await expect(popup.getByPlaceholder('Replace with')).toHaveValue('');
  if (SHOTS) await popup.screenshot({ path: path.join(SHOTS, 'popup-dark.png') });
});

test('Rule Library creates rules and imports FoxReplace files', async ({ context, extensionId, sw }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(page.getByText('No rules yet.')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'library-empty.png') });

  await page.getByRole('button', { name: 'New rule' }).click();
  const saveBox = await page.getByRole('button', { name: 'Save' }).boundingBox();
  expect(saveBox).not.toBeNull();
  expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  const permissionNote = page.getByText(/Your browser may ask for access to all websites/);
  await permissionNote.scrollIntoViewIfNeeded();
  await expect(permissionNote).toBeVisible();
  await page.getByLabel('Find').fill('teh');
  await page.getByLabel('Replace with').fill('the');
  await page.getByRole('radio', { name: 'Whole word' }).click();
  await page.getByLabel('Try it').fill('teh cat sat on tehm');
  await expect(page.getByText('the cat sat on tehm')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'library-editor.png') });
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.locator('.rule-list li')).toHaveCount(1);
  await expect(page.locator('.term-label').getByText('Replace with', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete rule teh' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete rule teh' }).click();
  await expect(page.locator('.rule-list li')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.rule-list li')).toHaveCount(1);
  const stored = await sw.evaluate(async () => (await chrome.storage.local.get('library')).library);
  expect(stored.rules[0]).toMatchObject({ find: 'teh', replace: 'the', match: 'word' });

  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('File').setInputFiles(path.resolve('test/fixtures/foxreplace-2.6.json'));
  await expect(page.getByText('from a FoxReplace file')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'library-import.png') });
  await page.getByRole('button', { name: 'Add to my rules' }).click();

  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('button', { name: 'Needs review 3' })).toBeVisible();
  await nav.getByRole('button', { name: /All rules/ }).click();
  await expect(page.locator('.rule-list li')).toHaveCount(7);
  await page.getByRole('button', { name: 'Disable all' }).click();
  await expect
    .poll(() =>
      sw.evaluate(async () => {
        const rules = (await chrome.storage.local.get('library')).library.rules as Array<{ enabled: boolean }>;
        return rules.every((rule) => !rule.enabled);
      }),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Enable all' }).click();
  await expect
    .poll(() =>
      sw.evaluate(async () => {
        const rules = (await chrome.storage.local.get('library')).library.rules as Array<{
          enabled: boolean;
          review: string | null;
        }>;
        return rules.filter((rule) => rule.review === null).every((rule) => rule.enabled);
      }),
    )
    .toBe(true);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'library-list.png') });

  await page.emulateMedia({ colorScheme: 'dark' });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'library-list-dark.png') });

  await page.getByRole('button', { name: 'Settings' }).click();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'library-settings.png') });
});
