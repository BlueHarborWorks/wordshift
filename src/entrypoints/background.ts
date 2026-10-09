import { AUTO_SCRIPT_ID, CONTENT_SCRIPT_FILE, type PageRequest } from '../shared/messages';
import { liveRules } from '../shared/rules';
import { loadLibrary, loadSettings, onDataChanged } from '../shared/storage';
import { preparePage, sendToPage } from '../shared/tabs';

export default defineBackground(() => {
  void syncAutoScript();
  onDataChanged(() => void syncAutoScript());
  browser.permissions.onAdded.addListener(() => void syncAutoScript());
  browser.permissions.onRemoved.addListener(() => void syncAutoScript());

  browser.commands.onCommand.addListener((command) => {
    if (command === 'apply-manual-rules') void applyManualToActiveTab();
  });
});

let syncing = Promise.resolve();

/**
 * Keeps the content script registered on exactly the sites the user granted, and only while
 * automatic rules exist. Calls are serialized because register/unregister are not atomic.
 */
function syncAutoScript(): Promise<void> {
  syncing = syncing.then(doSync, doSync);
  return syncing;
}

async function doSync(): Promise<void> {
  const [{ library }, settings, granted] = await Promise.all([
    loadLibrary(),
    loadSettings(),
    browser.permissions.getAll(),
  ]);
  const origins = granted.origins ?? [];
  const wanted = settings.autoApply && origins.length > 0 && liveRules(library).some((r) => r.apply.auto);

  const existing = await browser.scripting.getRegisteredContentScripts({ ids: [AUTO_SCRIPT_ID] });
  if (existing.length > 0) await browser.scripting.unregisterContentScripts({ ids: [AUTO_SCRIPT_ID] });
  if (!wanted) return;

  await browser.scripting.registerContentScripts([
    {
      id: AUTO_SCRIPT_ID,
      js: [CONTENT_SCRIPT_FILE],
      matches: origins,
      allFrames: true,
      runAt: 'document_idle',
      persistAcrossSessions: true,
    },
  ]);
}

async function applyManualToActiveTab(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  const request: PageRequest = { type: 'page:applyManual' };
  await preparePage(tab.id)
    .then(() => sendToPage(tab.id!, request))
    .catch(() => undefined);
}
