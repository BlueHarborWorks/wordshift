import { CONTENT_SCRIPT_FILE, HIGHLIGHT_CSS, type PageRequest, type PageResponse } from './messages';

/**
 * Makes sure the content script runs in the tab's top frame. Relies on activeTab (popup or
 * keyboard shortcut) or a granted host permission. Rejects on pages extensions cannot access,
 * such as browser settings pages and add-on stores. Injecting twice is harmless.
 */
export async function preparePage(tabId: number): Promise<void> {
  await browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
  await browser.scripting.insertCSS({ target: { tabId }, css: HIGHLIGHT_CSS }).catch(() => undefined);
}

export async function sendToPage(tabId: number, request: PageRequest): Promise<PageResponse> {
  const response = (await browser.tabs.sendMessage(tabId, request, { frameId: 0 })) as PageResponse | undefined;
  if (!response) throw new Error('No response from page.');
  return response;
}
