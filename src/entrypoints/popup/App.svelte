<script lang="ts">
  import { onMount } from 'svelte';
  import { inScope, permissionOrigins } from '../../core/sites';
  import type { Library, MatchMode, Settings } from '../../core/types';
  import type { PageRequest, PageStatus, QuickAction, QuickState } from '../../shared/messages';
  import { createRule } from '../../shared/library-ops';
  import { hostOf } from '../../shared/rules';
  import { loadLibrary, loadSettings, saveLibrary, saveSettings } from '../../shared/storage';
  import { preparePage, sendToPage } from '../../shared/tabs';
  import MatchOptions from '../../ui/MatchOptions.svelte';

  const DRAFT_KEY = 'quickDraft';

  let tabId: number | undefined;
  let tabUrl = $state('');
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

  let library = $state<Library | null>(null);
  let settings = $state<Settings | null>(null);
  let saveScope = $state<'site' | 'all'>('site');
  let saveOpen = $state(false);

  let findInput = $state<HTMLInputElement>();

  let lastRequest = 0;

  async function request(message: PageRequest, retries = 0) {
    if (tabId === undefined || pageError) return;
    const seq = ++lastRequest;
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await sendToPage(tabId, message);
        // Fast typing can get replies back out of order; only the newest one may update the view.
        if (seq !== lastRequest) return response;
        status = response.status;
        if (response.quick) quick = response.quick;
        return response;
      } catch {
        if (seq !== lastRequest) return;
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          continue;
        }
        pageError = 'Wordshift lost contact with this page. Reload it and try again.';
        return;
      }
    }
  }

  onMount(async () => {
    // `?tab=<id>` lets tests open the popup as a page aimed at another tab.
    const forcedTab = Number(new URLSearchParams(location.search).get('tab')) || undefined;
    const [tab] = forcedTab
      ? [await browser.tabs.get(forcedTab)]
      : await browser.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
    tabUrl = tab?.url ?? '';
    host = hostOf(tabUrl);

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
        // Firefox may resolve executeScript just before a large page finishes registering its
        // message listener. Retry this read-only handshake briefly; never retry mutations.
        await request({ type: 'page:status' }, 8);
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
    const response = await request({ type: 'quick:replaceOne', spec: currentSpec() });
    if (response?.replaced)
      notice = `Applied ${plural(response.replaced, 'replacement', 'replacements')} and kept it active in this tab.`;
  }

  async function replaceAll() {
    const response = await request({ type: 'quick:replaceAll', spec: currentSpec() });
    if (response?.replaced)
      notice = `Applied ${plural(response.replaced, 'replacement', 'replacements')} and kept it active in this tab.`;
  }

  async function undo() {
    const response = await request({ type: 'page:undo' });
    if (response) notice = 'Undid the last Quick Replace action.';
  }

  async function restoreQuickChanges() {
    const response = await request({ type: 'page:clearQuickChanges' });
    if (response) notice = 'Restored all Quick Replace changes on this page.';
  }

  async function removeQuickChange(action: QuickAction) {
    const response = await request({ type: 'page:removeQuickChange', actionId: action.id });
    if (response) notice = 'Restored that Quick Replace change.';
  }

  async function clearQuickSearch() {
    find = '';
    replace = '';
    match = 'text';
    caseSensitive = false;
    saveOpen = false;
    await request({ type: 'quick:clear' });
    notice = 'Quick Replace search cleared.';
  }

  async function setPaused(paused: boolean) {
    if (!settings || !host) return;
    const pausedSites = settings.pausedSites.filter((s) => s !== host);
    if (paused) pausedSites.push(host);
    settings = { ...settings, pausedSites };
    await saveSettings(settings);
    setTimeout(() => void request({ type: 'page:status' }), 150);
  }

  function turnOnAutomaticRules() {
    if (!settings) return;
    settings = { ...settings, autoApply: true };
    void saveSettings(settings);
    notice = 'Automatic replacement is on.';
    setTimeout(() => void request({ type: 'page:status' }), 150);
  }

  function turnOnMatchingGroups() {
    if (!library || disabledPageGroups.length === 0) return;
    const groupCount = disabledPageGroups.length;
    const ids = disabledPageGroups.map((group) => group.id);
    const origins: string[] = [];
    if (settings?.autoApply) {
      for (const rule of library.rules) {
        if (rule.groupId === null || !ids.includes(rule.groupId) || !rule.enabled || rule.review) continue;
        for (const origin of permissionOrigins(rule.sites)) if (!origins.includes(origin)) origins.push(origin);
      }
    }

    // Keep the permission request in the click handler. Firefox may close the popup when it prompts.
    const permission = origins.length > 0 ? browser.permissions.request({ origins }) : null;
    library = {
      ...library,
      groups: library.groups.map((group) => (ids.includes(group.id) ? { ...group, enabled: true } : group)),
    };
    void saveLibrary(library);
    notice = `${groupCount === 1 ? 'Group' : 'Groups'} turned on.`;
    void permission?.catch(() => undefined);
    setTimeout(() => void request({ type: 'page:status' }), 200);
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
  const quickActions = $derived(status?.quickActions ?? []);
  const hasQuickSearch = $derived(find !== '' || replace !== '' || match !== 'text' || caseSensitive);
  const disabledPageGroups = $derived.by(() => {
    if (!library || tabUrl === '') return [];
    const groupIds = new Set(
      library.rules
        .filter((rule) => rule.groupId !== null && rule.enabled && rule.review === null && inScope(tabUrl, rule.sites))
        .map((rule) => rule.groupId!),
    );
    return library.groups.filter((group) => !group.enabled && groupIds.has(group.id));
  });
  const disabledPageRuleCount = $derived(
    library
      ? library.rules.filter(
          (rule) =>
            rule.groupId !== null &&
            disabledPageGroups.some((group) => group.id === rule.groupId) &&
            rule.enabled &&
            rule.review === null &&
            inScope(tabUrl, rule.sites),
        ).length
      : 0,
  );
  const disabledGroupLabel = $derived(
    disabledPageGroups.length === 1
      ? `“${disabledPageGroups[0]!.name}” group`
      : `${disabledPageGroups.length} matching groups`,
  );
  const siteState = $derived(
    paused
      ? 'Automatic rules paused'
      : settings && !settings.autoApply
        ? 'Automatic rules off'
        : disabledPageGroups.length > 0
          ? 'Needs attention'
          : 'Active',
  );
  const countLabel = $derived(
    find === '' || quick.error ? '' : quick.count === 0 ? 'No matches' : `${quick.current + 1} of ${quick.count}`,
  );
  const matchHelp = $derived(
    match === 'text'
      ? 'Anywhere matches inside words too — “cat” matches “catalog”.'
      : match === 'word'
        ? 'Whole word matches only complete words — “cat” skips “catalog”.'
        : 'Regex matches a regular-expression pattern for advanced searches.',
  );
</script>

<main>
  <header>
    <h1>Wordshift</h1>
    <button class="btn" onclick={() => browser.runtime.openOptionsPage()}>Open Rule Library</button>
  </header>

  {#if pageError}
    <p class="page-error">{pageError}</p>
  {:else}
    <section class="quick" aria-label="Quick Replace">
      <div class="section-head">
        <h2>Quick replace</h2>
        <span class="status-chip">This tab</span>
      </div>
      <p class="section-help">
        Stays active in this tab and reapplies after reloads, even when automatic rules are paused.
      </p>
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
      <p class="match-help" aria-live="polite">{matchHelp}</p>

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
      </div>

      {#if quickActions.length > 0}
        <div class="quick-history" aria-label="Quick changes active in this tab">
          <div class="history-head">
            <strong>Quick changes active in this tab</strong>
            <span>{plural(quickActions.length, 'action', 'actions')}</span>
          </div>
          <ul>
            {#each quickActions as action, index (index)}
              <li>
                <span class="history-map" title={`${action.find} → ${action.replace}`}>
                  <code>{action.find}</code><span aria-hidden="true">→</span><code>{action.replace || '(empty)'}</code>
                </span>
                <span class="history-end">
                  <span class="history-count" title={plural(action.replacements, 'replacement', 'replacements')}
                    >{action.replacements}</span
                  >
                  <button
                    class="remove-quick"
                    aria-label={`Remove Quick change ${action.find} to ${action.replace || 'empty'}`}
                    title="Restore this Quick change"
                    onclick={() => removeQuickChange(action)}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.75" />
                    </svg>
                  </button>
                </span>
              </li>
            {/each}
          </ul>
          <div class="row history-actions">
            <button class="btn" disabled={!status?.canUndo} onclick={undo}>Undo last</button>
            <button class="btn quiet" onclick={restoreQuickChanges}>Restore all Quick changes</button>
          </div>
        </div>
      {/if}

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
          <p class="hint permission-hint">
            Your browser may ask for access to {saveScope === 'all' ? 'all websites' : host} when you save so the rule can
            run automatically.
          </p>
        {:else}
          <div class="row between">
            <button class="btn quiet link" disabled={find === '' || !!quick.error} onclick={() => (saveOpen = true)}
              >Save as automatic rule…</button
            >
            <button class="btn quiet" disabled={!hasQuickSearch} onclick={clearQuickSearch}>Clear search</button>
          </div>
        {/if}
      </div>
    </section>

    {#if notice}
      <p class="notice" role="status">{notice}</p>
    {/if}

    <section class="page" aria-label="This site">
      <div class="section-head">
        <h2>This site</h2>
        <span class:success={siteState === 'Active'} class:attention={siteState !== 'Active'} class="status-chip"
          >{siteState}</span
        >
      </div>

      {#if paused}
        <div class="activation">
          <p><strong>Automatic rules are paused on {host}.</strong> Quick Replace above still works.</p>
          <button class="btn primary" onclick={() => setPaused(false)}>Resume automatic rules</button>
        </div>
      {:else if settings && !settings.autoApply}
        <div class="activation">
          <p><strong>Automatic rules are off.</strong> Quick Replace above still works.</p>
          <button class="btn primary" onclick={turnOnAutomaticRules}>Turn on automatic rules</button>
        </div>
      {:else if disabledPageGroups.length > 0}
        <div class="activation">
          <p>
            <strong>{disabledGroupLabel} {disabledPageGroups.length === 1 ? 'is' : 'are'} off.</strong>
            {plural(disabledPageRuleCount, 'matching rule cannot', 'matching rules cannot')} run on this site.
          </p>
          <button class="btn primary" onclick={turnOnMatchingGroups}
            >Turn on {disabledPageGroups.length === 1 ? 'group' : 'groups'}</button
          >
        </div>
      {:else}
        <p class:success={status && status.autoReplacements > 0} class="site-summary muted">
          {#if status && status.autoReplacements > 0}
            {plural(status.autoRules, 'automatic rule', 'automatic rules')} made {plural(
              status.autoReplacements,
              'change',
              'changes',
            )} here.
          {:else if status && status.autoRules > 0}
            {plural(status.autoRules, 'automatic rule is', 'automatic rules are')} on. No matching text was found yet.
          {:else}
            No enabled automatic rules apply to this site.
          {/if}
        </p>
      {/if}

      <div class="row">
        {#if host && !paused}
          <button class="btn" title={`Pause automatic rules on ${host}`} onclick={() => setPaused(true)}
            >Pause automatic rules</button
          >
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
  h2 {
    font-size: var(--text-md);
  }
  .quick {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .section-help {
    margin: -3px 0 2px;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .status-chip {
    display: inline-flex;
    align-items: center;
    min-height: 20px;
    padding: 1px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-subtle);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .status-chip.attention {
    border-color: var(--border-strong);
    color: var(--text);
  }
  .status-chip.success {
    border-color: var(--success-border);
    background: var(--success-bg);
    color: var(--success);
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
  .nav .btn {
    width: 24px;
  }
  .actions {
    margin-top: 2px;
  }
  .match-help {
    margin: -3px 0 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .save select {
    flex: 1;
  }
  .permission-hint {
    margin-top: 6px;
  }
  .quick-history {
    padding: 8px;
    border: 1px solid var(--success-border);
    border-radius: var(--radius);
    background: var(--success-bg);
  }
  .history-head,
  .quick-history li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .history-head {
    margin-bottom: 5px;
    color: var(--success);
    font-size: var(--text-sm);
  }
  .history-head span,
  .history-count {
    color: var(--success);
    font-size: var(--text-xs);
  }
  .quick-history ul {
    max-height: 82px;
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
  }
  .quick-history li {
    padding: 4px 0;
    border-top: 1px solid var(--border);
  }
  .history-map {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 5px;
  }
  .history-map code {
    max-width: 104px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .history-count {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .history-end {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 5px;
  }
  .remove-quick {
    display: inline-grid;
    width: 22px;
    height: 22px;
    padding: 0;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--danger) 45%, transparent);
    border-radius: 5px;
    background: var(--bg);
    color: var(--danger);
    cursor: pointer;
  }
  .remove-quick:hover {
    border-color: var(--danger);
  }
  .remove-quick:active {
    transform: translateY(1px);
  }
  .history-actions {
    margin-top: 7px;
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
  .site-summary {
    margin-top: 8px !important;
  }
  .site-summary.success {
    color: var(--success);
    font-weight: 500;
  }
  .activation {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    margin: 8px 0;
    padding: 9px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg-subtle);
  }
  .activation p {
    margin: 0;
  }
  .page > p {
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
