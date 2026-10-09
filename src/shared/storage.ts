import { parseLibrary, type Issue } from '../core/schema';
import { DEFAULT_SETTINGS, emptyLibrary, type Library, type Settings } from '../core/types';

const LIBRARY_KEY = 'library';
const SETTINGS_KEY = 'settings';
/** A stored library that failed to parse is moved here instead of being overwritten. */
const QUARANTINE_KEY = 'libraryQuarantine';

export async function loadLibrary(): Promise<{ library: Library; issues: Issue[] }> {
  const stored = (await browser.storage.local.get(LIBRARY_KEY))[LIBRARY_KEY];
  if (stored === undefined) return { library: emptyLibrary(), issues: [] };

  const result = parseLibrary(stored);
  if (result.ok) return { library: result.library, issues: result.issues };

  await browser.storage.local.set({ [QUARANTINE_KEY]: { savedAt: new Date().toISOString(), data: stored } });
  await browser.storage.local.remove(LIBRARY_KEY);
  return { library: emptyLibrary(), issues: result.issues };
}

export async function saveLibrary(library: Library): Promise<void> {
  // Round-trip through JSON so Svelte proxies and undefined fields never reach storage.
  await browser.storage.local.set({ [LIBRARY_KEY]: JSON.parse(JSON.stringify(library)) });
}

export async function loadSettings(): Promise<Settings> {
  const stored = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<Settings> | undefined;
  return {
    autoApply: typeof stored?.autoApply === 'boolean' ? stored.autoApply : DEFAULT_SETTINGS.autoApply,
    pausedSites: Array.isArray(stored?.pausedSites)
      ? stored.pausedSites.filter((s): s is string => typeof s === 'string')
      : [],
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: JSON.parse(JSON.stringify(settings)) });
}

/** Calls `listener` whenever the library or settings change in any extension context. */
export function onDataChanged(listener: () => void): () => void {
  const handler = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && (LIBRARY_KEY in changes || SETTINGS_KEY in changes)) listener();
  };
  browser.storage.onChanged.addListener(handler);
  return () => browser.storage.onChanged.removeListener(handler);
}
