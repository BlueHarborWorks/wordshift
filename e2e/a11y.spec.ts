import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';
import { expect, library, PAGE_URL, rule, test } from './fixtures';

/*
 * Accessibility checks on every surface in both themes, plus keyboard-only runs of the main flows.
 * axe reports are filtered to serious and critical so the suite fails only on problems that block people.
 */

const SCHEMES = ['light', 'dark'] as const;

async function violations(page: import('@playwright/test').Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join('; ')})`);
}

const demo = () =>
  library([
    rule({ find: 'colour', replace: 'color', match: 'word' }),
    rule({
      find: 'PRJ-(\\d+)',
      replace: 'Ticket $1',
      match: 'regex',
      sites: { include: ['tracker.example.com'], exclude: [] },
    }),
    rule({ find: 'foo', replace: '', enabled: false, review: 'function-output', legacy: { output: 'x' } }),
  ]);

for (const scheme of SCHEMES) {
  test(`popup has no serious axe violations (${scheme})`, async ({ context, extensionId, sw }) => {
    const page = await context.newPage();
    await page.goto(PAGE_URL);
    const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]!.id!, PAGE_URL);
    const popup = await context.newPage();
    await popup.emulateMedia({ colorScheme: scheme });
    await popup.setViewportSize({ width: 364, height: 420 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
    await popup.getByPlaceholder('Find').fill('colour');
    await expect(popup.locator('#find-status')).toContainText('of');
    expect(await violations(popup)).toEqual([]);

    await popup.getByPlaceholder('Find').fill('(');
    await popup.getByRole('radio', { name: 'Regex' }).click();
    await expect(popup.getByRole('alert')).toBeVisible();
    expect(await violations(popup)).toEqual([]);
  });

  test(`Rule Library has no serious axe violations (${scheme})`, async ({ context, extensionId, sw }) => {
    await sw.evaluate((lib) => chrome.storage.local.set({ library: lib }), demo());
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1180, height: 760 });
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(page.locator('.rule-list li')).toHaveCount(3);
    expect(await violations(page), 'rule list').toEqual([]);

    await page.getByText('colour', { exact: true }).click();
    await expect(page.getByRole('form', { name: 'Edit rule' })).toBeVisible();
    expect(await violations(page), 'editor').toEqual([]);

    await page
      .getByRole('navigation')
      .getByRole('button', { name: /Needs review/ })
      .click();
    await page.getByText('foo', { exact: true }).click();
    await expect(page.getByRole('note')).toBeVisible();
    expect(await violations(page), 'review editor').toEqual([]);

    await page.getByRole('button', { name: 'Import' }).click();
    await page.getByLabel('File').setInputFiles(path.resolve('test/fixtures/foxreplace-2.6.json'));
    await expect(page.getByText('from a FoxReplace file')).toBeVisible();
    expect(await violations(page), 'import').toEqual([]);

    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(await violations(page), 'settings').toEqual([]);
  });
}

test('Quick Replace works by keyboard alone', async ({ context, extensionId, sw }) => {
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await expect(page.locator('#late')).toBeVisible();
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]!.id!, PAGE_URL);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);

  // Find is focused on open; typing searches, Enter steps.
  await expect(popup.getByPlaceholder('Find')).toBeFocused();
  await popup.keyboard.type('colour');
  await expect(popup.locator('#find-status')).toHaveText('1 of 3');
  await popup.keyboard.press('Enter');
  await expect(popup.locator('#find-status')).toHaveText('2 of 3');
  await popup.keyboard.press('Shift+Enter');
  await expect(popup.locator('#find-status')).toHaveText('1 of 3');

  // Tab to Replace, type, Enter replaces the current match.
  await popup.keyboard.press('Tab');
  await expect(popup.getByPlaceholder('Replace with')).toBeFocused();
  await popup.keyboard.type('hue');
  await popup.keyboard.press('Enter');
  await expect(popup.locator('#find-status')).toHaveText('1 of 2');
  await expect(page.locator('h1')).toHaveText('hue guide');

  // Arrow keys change the match mode; Ctrl+Enter in Replace replaces all.
  await popup.keyboard.press('Tab');
  await expect(popup.getByRole('radio', { name: 'Anywhere' })).toBeFocused();
  await popup.keyboard.press('ArrowRight');
  await expect(popup.getByRole('radio', { name: 'Whole word' })).toHaveAttribute('aria-checked', 'true');
  await popup.getByPlaceholder('Replace with').focus();
  await popup.keyboard.press('ControlOrMeta+Enter');
  await expect(popup.locator('#find-status')).toHaveText('No matches');
  await expect(page.locator('#p')).toHaveText('The hue of the sea.');

  // Undo is reachable by Tab and works with Enter.
  await popup.getByRole('button', { name: 'Undo last' }).focus();
  await popup.keyboard.press('Enter');
  await expect(page.locator('#p')).toHaveText('The colour of the sea.');
});

test('Rule Library works by keyboard alone', async ({ context, extensionId, sw }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByText('No rules yet.')).toBeVisible();

  // New rule: the editor opens with Find focused; Enter in a field saves.
  await page.getByRole('button', { name: 'New rule' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Find')).toBeFocused();
  await page.keyboard.type('teh');
  await page.keyboard.press('Tab');
  await page.keyboard.type('the');
  await page.keyboard.press('Enter');
  await expect(page.locator('.rule-list li')).toHaveCount(1);
  const stored = await sw.evaluate(async () => (await chrome.storage.local.get('library')).library);
  expect(stored.rules[0]).toMatchObject({ find: 'teh', replace: 'the' });

  // A rule row opens with Enter and the editor closes with Escape.
  await page.locator('.rule-main').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('form', { name: 'Edit rule' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('form', { name: 'Edit rule' })).toHaveCount(0);

  // The row's switch is a real checkbox: Space toggles it.
  await page.getByRole('switch').first().focus();
  await page.keyboard.press('Space');
  const after = await sw.evaluate(async () => (await chrome.storage.local.get('library')).library);
  expect(after.rules[0].enabled).toBe(false);
});

test('Rule Library fits a 320px-wide screen', async ({ context, extensionId, sw }) => {
  await sw.evaluate((lib) => chrome.storage.local.set({ library: lib }), demo());
  const page = await context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.locator('.rule-list li')).toHaveCount(3);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow(), 'rule list').toBe(0);
  if (process.env.WORDSHIFT_SHOTS)
    await page.screenshot({ path: path.join(process.env.WORDSHIFT_SHOTS, 'library-320.png'), fullPage: true });

  await page.getByText('colour', { exact: true }).click();
  await expect(page.getByRole('form', { name: 'Edit rule' })).toBeVisible();
  expect(await overflow(), 'editor').toBe(0);
  if (process.env.WORDSHIFT_SHOTS)
    await page.screenshot({ path: path.join(process.env.WORDSHIFT_SHOTS, 'library-320-editor.png'), fullPage: true });

  await page.getByRole('button', { name: 'Settings' }).click();
  expect(await overflow(), 'settings').toBe(0);
});
