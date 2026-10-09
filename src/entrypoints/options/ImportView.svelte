<script lang="ts">
  import { importFoxReplace, isFoxReplaceFile } from '../../core/foxreplace';
  import { parseLibrary, type Issue } from '../../core/schema';
  import type { Library } from '../../core/types';

  interface Props {
    onimport: (incoming: Library, mode: 'append' | 'replace') => void;
    oncancel: () => void;
  }

  let { onimport, oncancel }: Props = $props();

  let pending = $state<{ library: Library; source: string; needsReview: number; issues: Issue[] } | null>(null);
  let error = $state<string | null>(null);

  async function onfile(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    pending = null;
    error = null;
    if (!file) return;

    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch (e) {
      error = `${file.name} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`;
      return;
    }

    if (isFoxReplaceFile(json)) {
      const result = importFoxReplace(json);
      if (!result.ok) {
        error = result.issues[0]?.message ?? 'Could not read this FoxReplace file.';
        return;
      }
      pending = {
        library: result.library,
        source: 'FoxReplace',
        needsReview: result.needsReview,
        issues: result.issues,
      };
      return;
    }

    const result = parseLibrary(json);
    if (!result.ok) {
      error = result.issues[0]?.message ?? 'Could not read this file.';
      return;
    }
    pending = {
      library: result.library,
      source: 'Wordshift',
      needsReview: result.library.rules.filter((r) => r.review).length,
      issues: result.issues,
    };
  }
</script>

<section class="import">
  <h2>Import rules</h2>
  <p class="muted">Choose a Wordshift export, or a FoxReplace export (Options, Export) to bring your rules over.</p>

  <label class="label" for="import-file">File</label>
  <input id="import-file" type="file" accept=".json,application/json" onchange={onfile} />

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  {#if pending}
    <div class="report" role="status">
      <p>
        <strong>{pending.library.rules.length}</strong> rules in
        <strong>{pending.library.groups.length}</strong> groups from a {pending.source} file.
        {#if pending.needsReview > 0}
          {pending.needsReview} will be turned off until you review them.
        {/if}
      </p>
      {#if pending.issues.length > 0}
        <details>
          <summary>{pending.issues.length} notes</summary>
          <ul>
            {#each pending.issues as issue, i (i)}
              <li><span class="mono path">{issue.path || 'file'}</span> {issue.message}</li>
            {/each}
          </ul>
        </details>
      {/if}
    </div>
    <div class="actions">
      <button class="btn primary" onclick={() => onimport(pending!.library, 'append')}>Add to my rules</button>
      <button class="btn" onclick={() => onimport(pending!.library, 'replace')}>Replace my rules</button>
      <button class="btn quiet" onclick={oncancel}>Cancel</button>
    </div>
  {/if}
</section>

<style>
  .import {
    max-width: 640px;
  }
  h2 {
    margin-bottom: 4px;
    font-size: var(--text-lg);
  }
  .import > p {
    margin: 0 0 16px;
  }
  .report {
    margin-top: 16px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-subtle);
  }
  .report p {
    margin: 0;
  }
  details {
    margin-top: 8px;
  }
  summary {
    cursor: pointer;
    color: var(--text-muted);
  }
  ul {
    margin: 8px 0 0;
    padding-left: 18px;
  }
  li {
    margin-bottom: 4px;
  }
  .path {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
</style>
