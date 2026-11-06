import {
  AUTO_SCRIPT_ID,
  CONTENT_SCRIPT_FILE,
  HIGHLIGHT_CSS,
  type PageContextRequest,
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
  // Reply through sendResponse: Chrome before 148 ignores a promise returned by the listener.
  browser.runtime.onMessage.addListener((message: QuickSessionRequest | PageContextRequest, sender, sendResponse) => {
    if (message.type === 'pageContext:get') {
      sendResponse({ topUrl: sender.tab?.url });
      return false;
    }
    if (!message.type.startsWith('quickSession:') && message.type !== 'tabState:set') return false;
    const tabId = sender.tab?.id;
    if (tabId === undefined) return false;
    void handleTabMessage(tabId, message, sender).then(sendResponse, () => sendResponse(undefined));
    return true;
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    activeFrames.delete(tabId);
    void removeQuickSession(tabId);
  });
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      activeFrames.delete(tabId);
      void setBadgeActive(tabId, false);
    }
    if (changeInfo.status === 'complete') void restoreQuickContentScript(tabId);
  });
});

const QUICK_SESSIONS_KEY = 'quickSessions';

interface QuickSession {
  /** The top frame's address, and its Quick actions. */
  url: string;
  actions: QuickAction[];
  /** Quick actions inside embedded frames, by frame address. */
  frames?: Record<string, QuickAction[]>;
}

type QuickSessions = Record<string, QuickSession>;

/** Frames per tab whose Wordshift changes are active; the badge shows while any frame has some. */
const activeFrames = new Map<number, Set<number>>();
/** Session updates are serialized: several frames of one tab can report at the same time. */
let sessionQueue: Promise<unknown> = Promise.resolve();

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
  sender: Browser.runtime.MessageSender,
): Promise<QuickSessionResponse | undefined> {
  if (message.type === 'tabState:set') {
    const frames = activeFrames.get(tabId) ?? new Set<number>();
    if (message.active) frames.add(sender.frameId ?? 0);
    else frames.delete(sender.frameId ?? 0);
    activeFrames.set(tabId, frames);
    await setBadgeActive(tabId, frames.size > 0);
    return;
  }
  const run = () => updateQuickSession(tabId, message, sender.tab?.url);
  const result = sessionQueue.then(run, run);
  sessionQueue = result.catch(() => undefined);
  return result;
}

/**
 * Reads or stores a frame's Quick actions. The top frame's address decides whether the session
 * still applies: a different address means the tab moved on, and the session is dropped. An
 * embedded frame is matched by its own address, and only while the tab shows the same top page.
 */
async function updateQuickSession(
  tabId: number,
  message: Extract<QuickSessionRequest, { url: string }>,
  tabUrl: string | undefined,
): Promise<QuickSessionResponse> {
  const key = String(tabId);
  const sessions = await loadQuickSessions();
  const session = sessions[key];
  const top = message.top !== false;

  if (message.type === 'quickSession:get') {
    if (top) {
      if (session && session.url === message.url) return { actions: session.actions };
      if (session) {
        delete sessions[key];
        await saveQuickSessions(sessions);
      }
      return { actions: [] };
    }
    if (!session || tabUrl === undefined || session.url !== tabUrl) return { actions: [] };
    return { actions: session.frames?.[message.url] ?? [] };
  }

  let next: QuickSession;
  if (top) {
    next = { url: message.url, actions: message.actions };
    if (session?.url === message.url && session.frames) next.frames = session.frames;
  } else {
    // Without access to the tab's address, an embedded frame's changes last until the page reloads.
    if (tabUrl === undefined) return { actions: message.actions };
    const base = session?.url === tabUrl ? session : { url: tabUrl, actions: [] };
    const frames = { ...base.frames };
    if (message.actions.length > 0) frames[message.url] = message.actions;
    else delete frames[message.url];
    next = { url: base.url, actions: base.actions };
    if (Object.keys(frames).length > 0) next.frames = frames;
  }
  if (next.actions.length === 0 && !next.frames) delete sessions[key];
  else sessions[key] = next;
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
  const session = (await loadQuickSessions())[String(tabId)];
  if (!session) return;
  // Embedded frames are reached only with site access; the top frame is always tried.
  const allFrames = Object.keys(session.frames ?? {}).length > 0;
  for (const target of allFrames ? [{ tabId, allFrames }, { tabId }] : [{ tabId }]) {
    try {
      await browser.scripting.executeScript({ target, files: [CONTENT_SCRIPT_FILE] });
      await browser.scripting.insertCSS({ target, css: HIGHLIGHT_CSS }).catch(() => undefined);
      return;
    } catch {
      // activeTab access can be revoked by navigating away; the stale session is cleared on handshake.
    }
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

  const script = {
    id: AUTO_SCRIPT_ID,
    js: [CONTENT_SCRIPT_FILE],
    matches: origins,
    allFrames: true,
    runAt: 'document_idle' as const,
    persistAcrossSessions: true,
  };
  try {
    // Also run in about:srcdoc and about:blank frames, which some pages use for embedded content.
    await browser.scripting.registerContentScripts([{ ...script, matchOriginAsFallback: true }]);
  } catch {
    // A browser that does not support matchOriginAsFallback still gets every other frame.
    await browser.scripting.registerContentScripts([script]);
  }
}
