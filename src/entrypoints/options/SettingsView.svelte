<script lang="ts">
  import { ALL_URLS } from '../../core/sites';
  import type { Settings } from '../../core/types';
  import Switch from '../../ui/Switch.svelte';
  import { describeOrigin } from './access';

  interface Props {
    settings: Settings;
    required: string[];
    granted: string[];
    onsettings: (settings: Settings) => void;
  }

  let { settings, required, granted, onsettings }: Props = $props();

  const hasAll = $derived(granted.includes(ALL_URLS));
  const missing = $derived(hasAll ? [] : required.filter((o) => !granted.includes(o)));

  function allow(origins: string[]) {
    void browser.permissions.request({ origins });
  }

  function revoke(origin: string) {
    void browser.permissions.remove({ origins: [origin] });
  }

  function resume(host: string) {
    onsettings({ ...settings, pausedSites: settings.pausedSites.filter((s) => s !== host) });
  }
</script>

<section class="settings">
  <h2>Settings</h2>

  <div class="block">
    <Switch
      checked={settings.autoApply}
      label="Run automatic rules"
      onchange={(autoApply) => onsettings({ ...settings, autoApply })}
    />
    <p class="hint">When off, saved rules do not run. Quick Replace still works.</p>
  </div>

  <div class="block">
    <h3>Site access</h3>
    <p class="hint">
      Automatic rules need permission to read and change pages on the sites they run on. Wordshift asks only for the
      sites your rules use, and never sends page content anywhere.
    </p>

    {#if missing.length > 0}
      <div class="notice">
        <p>Your automatic rules cannot run on: {missing.map(describeOrigin).join(', ')}.</p>
        <button class="btn primary" onclick={() => allow(missing)}>Allow access</button>
      </div>
    {/if}

    {#if granted.length > 0}
      <ul class="list">
        {#each granted as origin (origin)}
          <li>
            <span>{describeOrigin(origin)}</span>
            <button class="btn quiet" onclick={() => revoke(origin)}>Remove</button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted small">No site access granted.</p>
    {/if}
  </div>

  <div class="block">
    <h3>Paused sites</h3>
    {#if settings.pausedSites.length > 0}
      <ul class="list">
        {#each settings.pausedSites as host (host)}
          <li>
            <span>{host}</span>
            <button class="btn quiet" onclick={() => resume(host)}>Resume</button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted small">None. Pause a site from the toolbar popup.</p>
    {/if}
  </div>

  <p class="muted small">Wordshift {browser.runtime.getManifest().version} · MIT License</p>
</section>

<style>
  .settings {
    max-width: 640px;
  }
  h2 {
    margin-bottom: 16px;
    font-size: var(--text-lg);
  }
  h3 {
    margin-bottom: 4px;
    font-size: var(--text-md);
  }
  .block {
    margin-bottom: 24px;
  }
  .notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-subtle);
  }
  .notice p {
    margin: 0;
  }
  .list {
    margin: 10px 0 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    list-style: none;
  }
  .list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 4px 4px 12px;
  }
  .list li + li {
    border-top: 1px solid var(--border);
  }
  .small {
    margin: 8px 0 0;
    font-size: var(--text-sm);
  }
</style>
