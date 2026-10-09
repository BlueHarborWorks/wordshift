<script lang="ts">
  import { onMount } from 'svelte';
  import { permissionOrigins } from '../../core/sites';
  import type { Library, MatchMode, Settings } from '../../core/types';
  import type { PageRequest, PageStatus, QuickState } from '../../shared/messages';
  import { createRule } from '../../shared/library-ops';
  import { hostOf } from '../../shared/rules';
  import { loadLibrary, loadSettings, saveLibrary, saveSettings } from '../../shared/storage';
  import { preparePage, sendToPage } from '../../shared/tabs';
  import MatchOptions from '../../ui/MatchOptions.svelte';

  const DRAFT_KEY = 'quickDraft';

  let tabId: number | undefined;
  let host = $state('');
  let ready = $state(false);
  let pageError = $state<string | null>(null);

  let find = $state('');
  let replace = $state('');
  let match = $state<MatchMode>('text');
  let caseSensitive = $state(false);

  let quick = $state<QuickState>({ count: 0, current: -1, error: null, warning: null });
  let status = $state<PageStatus | null>(null);
  let notice = $state('');

  let library: Library | null = null;
  let settings = $state<Settings | null>(null);
  let saveScope = $state<'site' | 'all'>('site');
  let saveOpen = $state(false);

  let findInput = $state<HTMLInputElement>();

  let lastRequest = 0;

  async function request(message: PageRequest) {
    if (tabId === undefined || pageError) return;
    const seq = ++lastRequest;
    try {
      const response = await sendToPage(tabId, message);
      // Fast typing can get replies back out of order; only the newest one may update the view.
      if (seq !== lastRequest) return response;
      status = response.status;
      if (response.quick) quick = response.quick;
      return response;
    } catch {
      pageError = 'Wordshift lost contact with this page. Reload it and try again.';
    }
  }

  onMount(async () => {
    // `?tab=<id>` lets tests open the popup as a page aimed at another tab.
    const forcedTab = Number(new URLSearchParams(location.search).get('tab')) || undefined;
    const [tab] = forcedTab
      ? [await browser.tabs.get(forcedTab)]
      : await browser.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
    host = hostOf(tab?.url ?? '');

    const session = browser.storage.session ?? browser.storage.local;
    const draft = (await session.get(DRAFT_KEY))[DRAFT_KEY] as
      { find: string; replace: string; match: MatchMode; caseSensitive: boolean } | undefined;
    if (draft) ({ find, replace, match, caseSensitive } = draft);

    [{ library }, settings] = await Promise.all([loadLibrary(), loadSettings()]);

    if (tabId === undefined) {
      pageError = 'No page is open.';
    } else {
      try {
        await preparePage(tabId);
        // Highlights belong to this popup; the page clears them when it closes.
        browser.tabs.connect(tabId, { name: 'quick', frameId: 0 });
        await request({ type: 'page:status' });
      } catch {
        pageError = 'Wordshift cannot change this page. Browser pages and add-on stores are protected.';
      }
    }
    ready = true;
    findInput?.select();
  });

  const currentSpec = () => ({ find, replace, match, caseSensitive });

  // Search as the user types, briefly debounced.
  $effect(() => {
    const spec = currentSpec();
    if (!ready) return;
    const session = browser.storage.session ?? browser.storage.local;
    void session.set({ [DRAFT_KEY]: spec });
    const timer = setTimeout(() => void request({ type: 'quick:find', spec }), 120);
    return () => clearTimeout(timer);
  });

  async function replaceOne() {
    await request({ type: 'quick:replaceOne', spec: currentSpec() });
  }

  async function replaceAll() {
    const response = await request({ type: 'quick:replaceAll', spec: currentSpec() });
    if (response?.replaced) notice = `Replaced ${plural(response.replaced, 'match', 'matches')}.`;
  }

  async function undo() {
    await request({ type: 'page:undo' });
    notice = 'Undone.';
  }

  async function applyManual() {
    const response = await request({ type: 'page:applyManual' });
    notice = response?.replaced
      ? `Rules made ${plural(response.replaced, 'change', 'changes')}.`
      : 'The manual rules for this site found nothing to change.';
  }

  async function setPaused(paused: boolean) {
    if (!settings || !host) return;
    const pausedSites = settings.pausedSites.filter((s) => s !== host);
    if (paused) pausedSites.push(host);
    settings = { ...settings, pausedSites };
    await saveSettings(settings);
    setTimeout(() => void request({ type: 'page:status' }), 150);
  }

  function saveAsRule() {
    if (!library || find === '') return;
    const sites = saveScope === 'site' && host ? { include: [host], exclude: [] } : { include: [], exclude: [] };
    library = { ...library, rules: [...library.rules, createRule({ find, replace, match, caseSensitive, sites })] };
    // Start the write before the permission prompt: in Firefox the prompt can close this popup.
    void saveLibrary(library);
    saveOpen = false;
    browser.permissions
      .request({ origins: permissionOrigins(sites) })
      .then((granted) => {
        notice = granted
          ? 'Rule saved. It will run automatically.'
          : 'Rule saved. Allow site access in the Rule Library to run it automatically.';
      })
      .catch(() => {
        notice = 'Rule saved.';
      });
  }

  function onFindKey(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void request({ type: 'quick:step', delta: event.shiftKey ? -1 : 1 });
  }

  function onReplaceKey(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) void replaceAll();
    else void replaceOne();
  }

  function plural(n: number, one: string, many: string) {
    return `${n} ${n === 1 ? one : many}`;
  }

  const paused = $derived(status?.paused ?? false);
  const manualRules = $derived(status?.manualRules ?? 0);
  const countLabel = $derived(
    find === '' || quick.error ? '' : quick.count === 0 ? 'No matches' : `${quick.current + 1} of ${quick.count}`,
  );
</script>

<main>
  <header>
    <h1>Wordshift</h1>
    <button class="btn quiet" onclick={() => browser.runtime.openOptionsPage()}>Rule Library</button>
  </header>

  {#if pageError}
    <p class="page-error">{pageError}</p>
  {:else}
    <section class="quick" aria-label="Quick Replace">
      <div class="row">
        <label class="visually-hidden" for="find">Find</label>
        <input
          id="find"
          class="field"
          class:mono={match === 'regex'}
          placeholder="Find"
          autocomplete="off"
          spellcheck="false"
          aria-invalid={quick.error ? 'true' : undefined}
          aria-describedby="find-status"
          bind:this={findInput}
          bind:value={find}
          onkeydown={onFindKey}
        />
        <span class="count" id="find-status" aria-live="polite">{countLabel}</span>
      </div>
      <div class="row">
        <label class="visually-hidden" for="replace">Replace with</label>
        <input
          id="replace"
          class="field"
          class:mono={match === 'regex'}
          placeholder="Replace with"
          autocomplete="off"
          spellcheck="false"
          bind:value={replace}
          onkeydown={onReplaceKey}
        />
      </div>

      <div class="row between">
        <MatchOptions {match} {caseSensitive} onchange={(v) => ({ match, caseSensitive } = v)} />
        <div class="nav">
          <button
            class="btn icon quiet"
            aria-label="Previous match"
            title="Previous (Shift+Enter)"
            disabled={quick.count === 0}
            onclick={() => request({ type: 'quick:step', delta: -1 })}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"
              ><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.5" /></svg
            >
          </button>
          <button
            class="btn icon quiet"
            aria-label="Next match"
            title="Next (Enter)"
            disabled={quick.count === 0}
            onclick={() => request({ type: 'quick:step', delta: 1 })}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"
              ><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" /></svg
            >
          </button>
        </div>
      </div>

      {#if quick.error}
        <p class="error" role="alert">{quick.error}</p>
      {:else if quick.warning}
        <p class="hint">{quick.warning}</p>
      {/if}

      <div class="row actions">
        <button class="btn" disabled={quick.count === 0} onclick={replaceOne} title="Enter in the Replace field"
          >Replace</button
        >
        <button
          class="btn primary"
          disabled={quick.count === 0}
          onclick={replaceAll}
          title="Ctrl+Enter or Cmd+Enter in the Replace field">Replace all</button
        >
        <span class="spacer"></span>
        <button class="btn quiet" disabled={!status?.canUndo} onclick={undo}>Undo</button>
      </div>

      <div class="save">
        {#if saveOpen}
          <div class="row">
            <label class="visually-hidden" for="scope">Where the rule applies</label>
            <select id="scope" class="field" bind:value={saveScope}>
              {#if host}<option value="site">On {host}</option>{/if}
              <option value="all">On all sites</option>
            </select>
            <button class="btn primary" disabled={find === '' || !!quick.error} onclick={saveAsRule}>Save</button>
            <button class="btn quiet" onclick={() => (saveOpen = false)}>Cancel</button>
          </div>
        {:else}
          <button class="btn quiet link" disabled={find === '' || !!quick.error} onclick={() => (saveOpen = true)}
            >Save as rule…</button
          >
        {/if}
      </div>
    </section>

    {#if notice}
      <p class="notice" role="status">{notice}</p>
    {/if}

    <section class="page" aria-label="This page">
      <p class="muted">
        {#if paused}
          Paused on {host}.
        {:else if status && status.autoReplacements > 0}
          {plural(status.autoRules, 'automatic rule', 'automatic rules')} made {plural(
            status.autoReplacements,
            'change',
            'changes',
          )} here.
        {:else}
          No automatic rules changed this page.
        {/if}
      </p>
      <div class="row">
        <button
          class="btn"
          onclick={applyManual}
          disabled={paused || manualRules === 0}
          title={manualRules === 0 ? 'No manual rules cover this site' : `${plural(manualRules, 'rule', 'rules')}`}
          >Apply manual rules</button
        >
        {#if host}
          <button class="btn quiet" onclick={() => setPaused(!paused)}>{paused ? 'Resume' : `Pause on ${host}`}</button>
        {/if}
      </div>
    </section>
  {/if}
</main>

<style>
  main {
    width: 340px;
    padding: 12px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  h1 {
    font-size: var(--text-lg);
  }
  .quick {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .row.between {
    justify-content: space-between;
  }
  .count {
    position: absolute;
    right: 8px;
    color: var(--text-muted);
    font-size: var(--text-sm);
    pointer-events: none;
  }
  #find {
    padding-right: 84px;
  }
  .nav {
    display: flex;
    gap: 2px;
  }
  .actions {
    margin-top: 2px;
  }
  .spacer {
    flex: 1;
  }
  .save select {
    flex: 1;
  }
  .link {
    padding: 0 4px;
    color: var(--text-muted);
  }
  .notice {
    margin: 10px 0 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .page {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  .page p {
    margin: 0 0 8px;
    font-size: var(--text-sm);
  }
  .page-error {
    margin: 0;
    color: var(--text-muted);
  }
  p.error,
  p.hint {
    margin: 0;
  }
</style>
