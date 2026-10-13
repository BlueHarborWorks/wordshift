import {
  AUTO_SCRIPT_ID,
  CONTENT_SCRIPT_FILE,
  HIGHLIGHT_CSS,
  type QuickAction,
  type QuickSessionRequest,
  type QuickSessionResponse,
} from '../shared/messages';
import { liveRules } from '../shared/rules';
import { loadLibrary, loadSettings, onDataChanged } from '../shared/storage';

export default defineBackground(() => {
  void syncAutoScript();
  onDataChanged(() => void syncAutoScript());
  browser.permissions.onAdded.addListener(() => void syncAutoScript());
  browser.permissions.onRemoved.addListener(() => void syncAutoScript());
  browser.runtime.onMessage.addListener((message: QuickSessionRequest, sender) => {
    if (!message.type.startsWith('quickSession:') && message.type !== 'tabState:set') return;
    const tabId = sender.tab?.id;
    if (tabId === undefined) return;
    return handleTabMessage(tabId, message);
  });
  browser.tabs.onRemoved.addListener((tabId) => void removeQuickSession(tabId));
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') void setBadgeActive(tabId, false);
    if (changeInfo.status === 'complete') void restoreQuickContentScript(tabId);
  });
});

const QUICK_SESSIONS_KEY = 'quickSessions';

interface QuickSession {
  url: string;
  actions: QuickAction[];
}

type QuickSessions = Record<string, QuickSession>;

function sessionStore() {
  return browser.storage.session ?? browser.storage.local;
}

async function loadQuickSessions(): Promise<QuickSessions> {
  return ((await sessionStore().get(QUICK_SESSIONS_KEY))[QUICK_SESSIONS_KEY] as QuickSessions | undefined) ?? {};
}

async function saveQuickSessions(sessions: QuickSessions): Promise<void> {
  await sessionStore().set({ [QUICK_SESSIONS_KEY]: sessions });
}

async function handleTabMessage(
  tabId: number,
  message: QuickSessionRequest,
): Promise<QuickSessionResponse | undefined> {
  if (message.type === 'tabState:set') {
    await setBadgeActive(tabId, message.active);
    return;
  }

  const sessions = await loadQuickSessions();
  if (message.type === 'quickSession:get') {
    const session = sessions[String(tabId)];
    if (!session || session.url !== message.url) {
      if (session) {
        delete sessions[String(tabId)];
        await saveQuickSessions(sessions);
      }
      return { actions: [] };
    }
    return { actions: session.actions };
  }

  if (message.actions.length === 0) delete sessions[String(tabId)];
  else sessions[String(tabId)] = { url: message.url, actions: message.actions };
  await saveQuickSessions(sessions);
  return { actions: message.actions };
}

async function removeQuickSession(tabId: number): Promise<void> {
  const sessions = await loadQuickSessions();
  if (!(String(tabId) in sessions)) return;
  delete sessions[String(tabId)];
  await saveQuickSessions(sessions);
}

async function restoreQuickContentScript(tabId: number): Promise<void> {
  const sessions = await loadQuickSessions();
  if (!sessions[String(tabId)]) return;
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
    await browser.scripting.insertCSS({ target: { tabId }, css: HIGHLIGHT_CSS }).catch(() => undefined);
  } catch {
    // activeTab access can be revoked by navigating away; the stale session is cleared on handshake.
  }
}

async function setBadgeActive(tabId: number, active: boolean): Promise<void> {
  await Promise.all([
    browser.action.setBadgeText({ tabId, text: active ? '•' : '' }),
    browser.action.setBadgeBackgroundColor({ tabId, color: '#237a45' }),
    browser.action.setTitle({ tabId, title: active ? 'Wordshift — active on this tab' : 'Wordshift' }),
  ]);
}

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
  const wanted = settings.autoApply && origins.length > 0 && liveRules(library).length > 0;

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
