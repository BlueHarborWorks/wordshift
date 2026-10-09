<script lang="ts">
  import { applyPatterns } from '../../core/apply';
  import { compilePattern } from '../../core/compile';
  import { sitePatternError } from '../../core/sites';
  import type { Group, ReviewReason, Rule } from '../../core/types';
  import MatchOptions from '../../ui/MatchOptions.svelte';

  interface Props {
    rule: Rule;
    groups: Group[];
    isNew: boolean;
    onsave: (rule: Rule) => void;
    oncancel: () => void;
    ondelete: () => void;
  }

  let { rule, groups, isNew, onsave, oncancel, ondelete }: Props = $props();

  // Edit a copy; nothing is stored until Save.
  // svelte-ignore state_referenced_locally
  let draft = $state<Rule>(structuredClone($state.snapshot(rule)) as Rule);
  // svelte-ignore state_referenced_locally
  let siteMode = $state<'all' | 'some'>(rule.sites.include.length === 0 ? 'all' : 'some');
  // svelte-ignore state_referenced_locally
  let includeText = $state(rule.sites.include.join('\n'));
  // svelte-ignore state_referenced_locally
  let excludeText = $state(rule.sites.exclude.join('\n'));
  let sample = $state('');

  const REVIEW_TEXT: Record<ReviewReason, string> = {
    'function-output':
      'This rule came from FoxReplace and used a JavaScript function to build its replacement. Wordshift does not run code from rules. Rewrite the replacement as text (in Regex mode you can use $1 or $<name>), then mark it reviewed.',
    'html-mode':
      'This rule came from FoxReplace and used HTML mode. Wordshift only changes text, so the result may differ. Check the replacement, then mark it reviewed.',
    'site-pattern': 'Some of this rule’s FoxReplace URL patterns could not be converted. Check where it runs.',
    'invalid-pattern': 'The find pattern is not valid. Fix it to use this rule.',
  };

  const lines = (text: string) =>
    text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

  const compiled = $derived(compilePattern(draft));
  const include = $derived(siteMode === 'all' ? [] : lines(includeText));
  const exclude = $derived(lines(excludeText));
  const siteErrors = $derived(
    [...include, ...exclude].map((p) => sitePatternError(p) && `${p}: ${sitePatternError(p)}`).filter(Boolean),
  );
  const preview = $derived(compiled.ok && sample !== '' ? applyPatterns(sample, [compiled.pattern]) : null);
  const canSave = $derived(
    compiled.ok &&
      siteErrors.length === 0 &&
      !(siteMode === 'some' && include.length === 0) &&
      (draft.apply.auto || draft.apply.manual),
  );

  function save() {
    if (!canSave) return;
    const out = $state.snapshot(draft) as Rule;
    out.sites = { include, exclude };
    if (out.review === 'invalid-pattern' || out.review === 'site-pattern') out.review = null;
    onsave(out);
  }

  function markReviewed() {
    draft.review = null;
    draft.enabled = true;
    delete draft.legacy;
  }
</script>

<form
  class="editor"
  aria-label={isNew ? 'New rule' : 'Edit rule'}
  onsubmit={(e) => {
    e.preventDefault();
    save();
  }}
>
  <header>
    <h2>{isNew ? 'New rule' : 'Edit rule'}</h2>
  </header>

  {#if draft.review}
    <div class="review" role="note">
      <p>{REVIEW_TEXT[draft.review]}</p>
      {#if draft.legacy}
        <pre class="mono">{JSON.stringify(draft.legacy, null, 2)}</pre>
      {/if}
      {#if draft.review === 'function-output' || draft.review === 'html-mode'}
        <button type="button" class="btn" onclick={markReviewed}>Mark reviewed and enable</button>
      {/if}
    </div>
  {/if}

  <div class="group">
    <label class="label" for="rule-find">Find</label>
    <input
      id="rule-find"
      class="field"
      class:mono={draft.match === 'regex'}
      spellcheck="false"
      autocomplete="off"
      aria-invalid={!compiled.ok && draft.find !== '' ? 'true' : undefined}
      bind:value={draft.find}
    />
    {#if !compiled.ok && draft.find !== ''}
      <p class="error">{compiled.error}</p>
    {:else if compiled.ok && compiled.warnings[0]}
      <p class="hint">{compiled.warnings[0]}</p>
    {/if}
  </div>

  <div class="group">
    <label class="label" for="rule-replace">Replace with</label>
    <input
      id="rule-replace"
      class="field"
      class:mono={draft.match === 'regex'}
      spellcheck="false"
      autocomplete="off"
      bind:value={draft.replace}
    />
    {#if draft.match === 'regex'}
      <p class="hint">Use $1, $2 or $&lt;name&gt; for captured text, $&amp; for the whole match.</p>
    {/if}
  </div>

  <MatchOptions
    match={draft.match}
    caseSensitive={draft.caseSensitive}
    onchange={(v) => ((draft.match = v.match), (draft.caseSensitive = v.caseSensitive))}
  />

  <fieldset class="group">
    <legend class="label">Runs on</legend>
    <label class="choice"><input type="radio" value="all" bind:group={siteMode} /> All sites</label>
    <label class="choice"><input type="radio" value="some" bind:group={siteMode} /> Only these sites</label>
    {#if siteMode === 'some'}
      <label class="visually-hidden" for="rule-include">Sites, one per line</label>
      <textarea
        id="rule-include"
        class="field mono"
        rows="3"
        spellcheck="false"
        placeholder="example.com&#10;news.example.org/world"
        bind:value={includeText}></textarea>
    {/if}
    <label class="label except" for="rule-exclude">Except on</label>
    <textarea id="rule-exclude" class="field mono" rows="2" spellcheck="false" bind:value={excludeText}></textarea>
    <p class="hint">
      One per line. <span class="mono">example.com</span> includes its subdomains; add a path to narrow it. Use
      <span class="mono">https://…/*</span> to match full URLs.
    </p>
    {#each siteErrors as error (error)}
      <p class="error">{error}</p>
    {/each}
  </fieldset>

  <fieldset class="group">
    <legend class="label">When</legend>
    <label class="choice"><input type="checkbox" bind:checked={draft.apply.auto} /> Automatically on every visit</label>
    <label class="choice"
      ><input type="checkbox" bind:checked={draft.apply.manual} /> When I choose “Apply manual rules”</label
    >
  </fieldset>

  {#if groups.length > 0}
    <div class="group">
      <label class="label" for="rule-group">Group</label>
      <select id="rule-group" class="field" bind:value={draft.groupId}>
        <option value={null}>No group</option>
        {#each groups as g (g.id)}
          <option value={g.id}>{g.name}</option>
        {/each}
      </select>
    </div>
  {/if}

  <div class="group">
    <label class="label" for="rule-sample">Try it</label>
    <textarea id="rule-sample" class="field" rows="2" placeholder="Paste sample text" bind:value={sample}></textarea>
    {#if preview}
      <p class="preview" aria-live="polite">
        <span class="muted">{preview.counts[0] === 0 ? 'No match' : 'Result'}:</span>
        {preview.text}
      </p>
    {/if}
  </div>

  <footer>
    {#if !isNew}
      <button type="button" class="btn quiet danger" onclick={ondelete}>Delete</button>
    {/if}
    <span class="spacer"></span>
    <button type="button" class="btn" onclick={oncancel}>Cancel</button>
    <button type="submit" class="btn primary" disabled={!canSave}>Save</button>
  </footer>
</form>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  h2 {
    font-size: var(--text-lg);
  }
  .group {
    margin: 0;
    padding: 0;
    border: 0;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }
  .except {
    margin-top: 10px;
  }
  .review {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-subtle);
  }
  .review p {
    margin: 0 0 8px;
  }
  .review pre {
    margin: 0 0 8px;
    padding: 8px;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    font-size: var(--text-sm);
  }
  .preview {
    margin: 6px 0 0;
    white-space: pre-wrap;
    word-break: break-word;
  }
  footer {
    display: flex;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .spacer {
    flex: 1;
  }
</style>
