<script lang="ts">
  import { onMount } from 'svelte';
  import { newId } from '../../core/schema';
  import { emptyLibrary, DEFAULT_SETTINGS, type Library, type Rule, type Settings } from '../../core/types';
  import { createRule, mergeLibraries } from '../../shared/library-ops';
  import { requiredOrigins } from '../../shared/rules';
  import { loadLibrary, loadSettings, onDataChanged, saveLibrary, saveSettings } from '../../shared/storage';
  import { permissionOrigins } from '../../core/sites';
  import Switch from '../../ui/Switch.svelte';
  import { hasAccess } from './access';
  import ImportView from './ImportView.svelte';
  import RuleEditor from './RuleEditor.svelte';
  import SettingsView from './SettingsView.svelte';

  type View = { kind: 'rules'; filter: 'all' | 'review' | string } | { kind: 'import' } | { kind: 'settings' };

  let library = $state<Library>(emptyLibrary());
  let settings = $state<Settings>(DEFAULT_SETTINGS);
  let granted = $state<string[]>([]);
  let loaded = $state(false);
  let loadNotes = $state<string[]>([]);

  let view = $state<View>({ kind: 'rules', filter: 'all' });
  let query = $state('');
  let editing = $state<{ rule: Rule; isNew: boolean } | null>(null);
  let toast = $state<{ message: string; undo?: () => void } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  async function refresh() {
    const [loadedLibrary, loadedSettings, perms] = await Promise.all([
      loadLibrary(),
      loadSettings(),
      browser.permissions.getAll(),
    ]);
    library = loadedLibrary.library;
    settings = loadedSettings;
    granted = perms.origins ?? [];
    return loadedLibrary.issues;
  }

  onMount(() => {
    void refresh().then((issues) => {
      loadNotes = issues.map((i) => `${i.path}: ${i.message}`);
      loaded = true;
    });
    const stop = onDataChanged(() => void refresh());
    const updatePerms = () => void browser.permissions.getAll().then((p) => (granted = p.origins ?? []));
    browser.permissions.onAdded.addListener(updatePerms);
    browser.permissions.onRemoved.addListener(updatePerms);
    return () => {
      stop();
      browser.permissions.onAdded.removeListener(updatePerms);
      browser.permissions.onRemoved.removeListener(updatePerms);
    };
  });

  function commit(next: Library, message?: string, undoTo?: Library) {
    library = next;
    void saveLibrary(next);
    if (message) showToast(message, undoTo && (() => commit(undoTo)));
  }

  function showToast(message: string, undo?: () => void) {
    clearTimeout(toastTimer);
    toast = { message, undo };
    toastTimer = setTimeout(() => (toast = null), 6000);
  }

  // Rules visible in the current view.
  const visible = $derived.by(() => {
    if (view.kind !== 'rules') return [];
    const filter = view.filter;
    const q = query.trim().toLowerCase();
    return library.rules.filter((r) => {
      if (filter === 'review' && !r.review) return false;
      if (filter !== 'all' && filter !== 'review' && r.groupId !== filter) return false;
      if (!q) return true;
      return [r.find, r.replace, ...r.sites.include].some((s) => s.toLowerCase().includes(q));
    });
  });

  const reviewCount = $derived(library.rules.filter((r) => r.review).length);
  const currentGroup = $derived.by(() => {
    const v = view;
    return v.kind === 'rules' ? library.groups.find((g) => g.id === v.filter) : undefined;
  });
  const disabledGroups = $derived(new Set(library.groups.filter((g) => !g.enabled).map((g) => g.id)));
  const required = $derived(requiredOrigins(library));
  const accessMissing = $derived(
    settings.autoApply && library.rules.some((r) => r.enabled && !r.review && r.apply.auto && !hasAccess(r, granted)),
  );

  function groupCount(id: string) {
    return library.rules.filter((r) => r.groupId === id).length;
  }

  function newRule() {
    const groupId = currentGroup?.id ?? null;
    editing = {
      rule: createRule({ find: '', replace: '', match: 'text', caseSensitive: false, groupId }),
      isNew: true,
    };
  }

  function saveRule(rule: Rule) {
    // Ask for site access inside the click, before anything is awaited, so the browser allows the prompt.
    if (rule.enabled && rule.apply.auto && settings.autoApply && !hasAccess(rule, granted)) {
      void browser.permissions.request({ origins: permissionOrigins(rule.sites) });
    }
    const exists = library.rules.some((r) => r.id === rule.id);
    const rules = exists ? library.rules.map((r) => (r.id === rule.id ? rule : r)) : [...library.rules, rule];
    commit({ ...library, rules });
    editing = null;
  }

  function deleteRule(rule: Rule) {
    const before = library;
    commit({ ...library, rules: library.rules.filter((r) => r.id !== rule.id) }, 'Rule deleted.', before);
    editing = null;
  }

  function toggleRule(rule: Rule, enabled: boolean) {
    if (enabled && rule.apply.auto && settings.autoApply && !hasAccess(rule, granted)) {
      void browser.permissions.request({ origins: permissionOrigins(rule.sites) });
    }
    commit({ ...library, rules: library.rules.map((r) => (r.id === rule.id ? { ...r, enabled } : r)) });
  }

  function allowAccess(origins: string[]) {
    void browser.permissions.request({ origins });
  }

  function setAutoApply(autoApply: boolean) {
    settings = { ...settings, autoApply };
    void saveSettings(settings);
  }

  function addGroup() {
    const group = { id: newId(), name: 'New group', enabled: true };
    commit({ ...library, groups: [...library.groups, group] });
    view = { kind: 'rules', filter: group.id };
  }

  function updateGroup(id: string, patch: { name?: string; enabled?: boolean }) {
    commit({ ...library, groups: library.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) });
  }

  function deleteGroup(id: string) {
    const before = library;
    commit(
      {
        ...library,
        groups: library.groups.filter((g) => g.id !== id),
        rules: library.rules.map((r) => (r.groupId === id ? { ...r, groupId: null } : r)),
      },
      'Group deleted. Its rules are now ungrouped.',
      before,
    );
    view = { kind: 'rules', filter: 'all' };
  }

  function importRules(incoming: Library, mode: 'append' | 'replace') {
    const before = library;
    const next = mode === 'replace' ? incoming : mergeLibraries(library, incoming);
    commit(next, `Imported ${incoming.rules.length} rules.`, before);
    view = { kind: 'rules', filter: incoming.rules.some((r) => r.review) ? 'review' : 'all' };
  }

  function exportRules() {
    const blob = new Blob([JSON.stringify($state.snapshot(library), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wordshift-rules-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function scopeLabel(rule: Rule) {
    const { include, exclude } = rule.sites;
    let text =
      include.length === 0 ? 'All sites' : include.length === 1 ? include[0]! : `${include[0]} +${include.length - 1}`;
    if (exclude.length > 0) text += ` (except ${exclude.length})`;
    return text;
  }

  function whenLabel(rule: Rule) {
    if (rule.apply.auto && rule.apply.manual) return 'Auto';
    return rule.apply.auto ? 'Auto only' : 'Manual';
  }

  const REVIEW_SHORT = {
    'function-output': 'Needs review: used a JavaScript function',
    'html-mode': 'Needs review: used HTML mode',
    'site-pattern': 'Needs review: site patterns',
    'invalid-pattern': 'Needs review: invalid pattern',
  } as const;
</script>

<div class="layout">
  <nav aria-label="Library">
    <h1>Wordshift</h1>
    <ul>
      <li>
        <button
          aria-current={view.kind === 'rules' && view.filter === 'all' ? 'page' : undefined}
          onclick={() => ((view = { kind: 'rules', filter: 'all' }), (editing = null))}
        >
          All rules <span class="n">{library.rules.length}</span>
        </button>
      </li>
      {#if reviewCount > 0}
        <li>
          <button
            aria-current={view.kind === 'rules' && view.filter === 'review' ? 'page' : undefined}
            onclick={() => ((view = { kind: 'rules', filter: 'review' }), (editing = null))}
          >
            Needs review <span class="n">{reviewCount}</span>
          </button>
        </li>
      {/if}
    </ul>

    <div class="nav-head">
      <h2>Groups</h2>
      <button class="btn quiet icon" aria-label="New group" title="New group" onclick={addGroup}>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"
          ><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" /></svg
        >
      </button>
    </div>
    <ul>
      {#each library.groups as group (group.id)}
        <li>
          <button
            class:off={!group.enabled}
            aria-current={view.kind === 'rules' && view.filter === group.id ? 'page' : undefined}
            onclick={() => ((view = { kind: 'rules', filter: group.id }), (editing = null))}
          >
            {group.name} <span class="n">{groupCount(group.id)}</span>
          </button>
        </li>
      {:else}
        <li class="empty">No groups</li>
      {/each}
    </ul>

    <ul class="bottom">
      <li>
        <button aria-current={view.kind === 'import' ? 'page' : undefined} onclick={() => (view = { kind: 'import' })}
          >Import</button
        >
      </li>
      <li><button onclick={exportRules} disabled={library.rules.length === 0}>Export</button></li>
      <li>
        <button
          aria-current={view.kind === 'settings' ? 'page' : undefined}
          onclick={() => (view = { kind: 'settings' })}>Settings</button
        >
      </li>
    </ul>
  </nav>

  <main>
    {#if loadNotes.length > 0}
      <div class="banner" role="alert">
        <p>Some saved rules needed repair when loading:</p>
        <ul>
          {#each loadNotes as note (note)}<li>{note}</li>{/each}
        </ul>
        <button class="btn quiet" onclick={() => (loadNotes = [])}>Dismiss</button>
      </div>
    {/if}

    {#if view.kind === 'import'}
      <ImportView onimport={importRules} oncancel={() => (view = { kind: 'rules', filter: 'all' })} />
    {:else if view.kind === 'settings'}
      <SettingsView
        {settings}
        {required}
        {granted}
        onsettings={(next) => ((settings = next), void saveSettings(next))}
      />
    {:else}
      <div class="content" class:with-editor={editing !== null}>
        <section class="rules" aria-label="Rules">
          <div class="toolbar">
            {#if currentGroup}
              <input
                class="group-name"
                aria-label="Group name"
                value={currentGroup.name}
                onchange={(e) =>
                  updateGroup(currentGroup.id, { name: e.currentTarget.value.trim() || 'Untitled group' })}
              />
              <Switch
                checked={currentGroup.enabled}
                label="Group on"
                hideLabel
                onchange={(enabled) => updateGroup(currentGroup.id, { enabled })}
              />
              <button class="btn quiet danger" onclick={() => deleteGroup(currentGroup.id)}>Delete group</button>
            {:else}
              <h2>{view.filter === 'review' ? 'Needs review' : 'All rules'}</h2>
            {/if}
            <span class="spacer"></span>
            <label class="visually-hidden" for="search">Search rules</label>
            <input id="search" class="field search" type="search" placeholder="Search" bind:value={query} />
            <button class="btn primary" onclick={newRule}>New rule</button>
          </div>

          {#if !settings.autoApply}
            <div class="banner">
              <p>Automatic rules are turned off. Rules only run when you choose “Apply manual rules”.</p>
              <button class="btn" onclick={() => setAutoApply(true)}>Turn on</button>
            </div>
          {:else if accessMissing}
            <div class="banner">
              <p>Some automatic rules cannot run yet because Wordshift does not have access to their sites.</p>
              <button class="btn" onclick={() => allowAccess(requiredOrigins(library))}>Allow access</button>
            </div>
          {/if}

          {#if !loaded}
            <p class="muted">Loading…</p>
          {:else if visible.length === 0}
            <div class="empty-state">
              {#if library.rules.length === 0}
                <p>No rules yet.</p>
                <p class="muted">
                  Create one here, or use “Save as rule” in the toolbar popup. Coming from FoxReplace? Use Import.
                </p>
              {:else}
                <p class="muted">No rules match.</p>
              {/if}
            </div>
          {:else}
            <ul class="rule-list">
              {#each visible as rule (rule.id)}
                {@const groupOff = rule.groupId !== null && disabledGroups.has(rule.groupId)}
                <li class:selected={editing?.rule.id === rule.id} class:off={!rule.enabled || groupOff}>
                  <Switch
                    checked={rule.enabled}
                    disabled={rule.review !== null}
                    label={`Rule ${rule.find} on`}
                    hideLabel
                    onchange={(enabled) => toggleRule(rule, enabled)}
                  />
                  <div
                    class="rule-main"
                    role="button"
                    tabindex="0"
                    onclick={() => (editing = { rule, isNew: false })}
                    onkeydown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        editing = { rule, isNew: false };
                      }
                    }}
                  >
                    <span class="pair">
                      <span class="find" class:mono={rule.match === 'regex'}>{rule.find}</span>
                      <span class="arrow" aria-label="becomes">→</span>
                      <span class="replace" class:mono={rule.match === 'regex'}
                        >{rule.replace === '' ? '(remove)' : rule.replace}</span
                      >
                    </span>
                    <span class="meta">
                      {#if rule.review}
                        {REVIEW_SHORT[rule.review]}
                      {:else}
                        {scopeLabel(rule)} · {whenLabel(rule)}{rule.match !== 'text'
                          ? ` · ${rule.match === 'word' ? 'Whole word' : 'Regex'}`
                          : ''}{rule.caseSensitive ? ' · Match case' : ''}{groupOff ? ' · Group off' : ''}
                        {#if settings.autoApply && rule.enabled && rule.apply.auto && !hasAccess(rule, granted)}
                          · <button class="needs" onclick={() => allowAccess(permissionOrigins(rule.sites))}
                            >Needs site access: allow</button
                          >
                        {/if}
                      {/if}
                    </span>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        {#if editing}
          {#key editing.rule.id}
            <aside class="drawer">
              <RuleEditor
                rule={editing.rule}
                isNew={editing.isNew}
                groups={library.groups}
                onsave={saveRule}
                oncancel={() => (editing = null)}
                ondelete={() => editing && deleteRule(editing.rule)}
              />
            </aside>
          {/key}
        {/if}
      </div>
    {/if}
  </main>
</div>

{#if toast}
  <div class="toast" role="status">
    <span>{toast.message}</span>
    {#if toast.undo}
      <button
        class="btn quiet"
        onclick={() => {
          toast?.undo?.();
          toast = null;
        }}>Undo</button
      >
    {/if}
  </div>
{/if}

<svelte:head>
  <title>Wordshift Rule Library</title>
</svelte:head>

<style>
  .layout {
    display: grid;
    grid-template-columns: 220px 1fr;
    min-height: 100vh;
  }
  nav {
    display: flex;
    flex-direction: column;
    padding: 16px 10px;
    border-right: 1px solid var(--border);
    background: var(--bg-subtle);
  }
  nav h1 {
    margin: 0 8px 16px;
    font-size: var(--text-lg);
  }
  nav ul {
    margin: 0 0 16px;
    padding: 0;
    list-style: none;
  }
  nav li button {
    display: flex;
    justify-content: space-between;
    width: 100%;
    padding: 5px 8px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  nav li button:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  nav li button[aria-current='page'] {
    background: var(--bg-active);
    font-weight: 500;
  }
  nav li button:disabled {
    color: var(--text-faint);
    cursor: default;
  }
  nav li button.off {
    color: var(--text-muted);
  }
  .n {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .nav-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 0 4px 8px;
  }
  .nav-head h2 {
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 500;
  }
  .empty {
    padding: 4px 8px;
    color: var(--text-faint);
    font-size: var(--text-sm);
  }
  .bottom {
    margin-top: auto;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  main {
    min-width: 0;
    padding: 16px 24px;
  }
  .content {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
  }
  .content.with-editor {
    grid-template-columns: minmax(0, 1fr) minmax(320px, 400px);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  .toolbar h2 {
    font-size: var(--text-lg);
  }
  .group-name {
    min-width: 0;
    padding: 2px 6px;
    margin-left: -6px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    font: 600 var(--text-lg) var(--font);
  }
  .group-name:hover {
    border-color: var(--border);
  }
  .group-name:focus {
    border-color: var(--focus);
    outline: none;
  }
  .search {
    width: 200px;
  }
  .spacer {
    flex: 1;
  }

  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-subtle);
  }
  .banner p,
  .banner ul {
    margin: 0;
  }

  .rule-list {
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    list-style: none;
  }
  .rule-list li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 0 0 12px;
  }
  .rule-list li + li {
    border-top: 1px solid var(--border);
  }
  .rule-list li.selected {
    background: var(--bg-subtle);
  }
  .rule-main {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: 9px 12px 9px 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .pair {
    display: flex;
    gap: 8px;
    min-width: 0;
  }
  .find,
  .replace {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .find {
    font-weight: 500;
  }
  .arrow {
    color: var(--text-faint);
  }
  .meta {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .needs {
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-decoration: underline dotted;
    cursor: pointer;
  }
  li.off .pair {
    color: var(--text-muted);
  }

  .empty-state {
    padding: 40px 0;
    text-align: center;
  }
  .empty-state p {
    margin: 0 0 4px;
  }

  .drawer {
    align-self: start;
    position: sticky;
    top: 16px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
  }

  .toast {
    position: fixed;
    bottom: 16px;
    left: 50%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 6px 6px 14px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.12);
    transform: translateX(-50%);
  }

  @media (max-width: 860px) {
    .layout {
      grid-template-columns: 1fr;
    }
    nav {
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }
    .content.with-editor {
      grid-template-columns: minmax(0, 1fr);
    }
    .drawer {
      position: static;
    }
    .search {
      width: 140px;
    }
  }
</style>
