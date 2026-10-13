<script lang="ts">
  import type { MatchMode } from '../core/types';

  interface Props {
    match: MatchMode;
    caseSensitive: boolean;
    onchange: (value: { match: MatchMode; caseSensitive: boolean }) => void;
  }

  let { match, caseSensitive, onchange }: Props = $props();

  const modes: { value: MatchMode; label: string; accessibleLabel?: string; title: string }[] = [
    { value: 'text', label: 'Anywhere', title: 'Match these characters anywhere, including inside words' },
    { value: 'word', label: 'Whole', accessibleLabel: 'Whole word', title: 'Match only a complete word' },
    { value: 'regex', label: 'Regex', title: 'Regular expression; use $1, $<name> in the replacement' },
  ];

  // Arrow keys move between the modes, as they do in a native radio group.
  function onKeydown(event: KeyboardEvent) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const index = modes.findIndex((m) => m.value === match);
    const next = modes[(index + step + modes.length) % modes.length]!;
    onchange({ match: next.value, caseSensitive });
    (event.currentTarget as HTMLElement).parentElement
      ?.querySelector<HTMLElement>(`[data-mode="${next.value}"]`)
      ?.focus();
  }
</script>

<div class="options">
  <div class="segmented" role="radiogroup" aria-label="Match">
    {#each modes as mode (mode.value)}
      <button
        type="button"
        role="radio"
        data-mode={mode.value}
        aria-label={mode.accessibleLabel}
        aria-checked={match === mode.value}
        tabindex={match === mode.value ? 0 : -1}
        title={mode.title}
        onkeydown={onKeydown}
        onclick={() => onchange({ match: mode.value, caseSensitive })}>{mode.label}</button
      >
    {/each}
  </div>
  <button
    type="button"
    class="case"
    aria-pressed={caseSensitive}
    title="Match case"
    onclick={() => onchange({ match, caseSensitive: !caseSensitive })}
  >
    Match case
  </button>
</div>

<style>
  .options {
    display: flex;
    gap: 6px;
  }
  .segmented {
    display: inline-flex;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-subtle);
  }
  button {
    height: 22px;
    padding: 0 8px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }
  button:hover {
    color: var(--text);
  }
  button[aria-checked='true'] {
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 0 0 1px var(--border-strong);
  }
  .case {
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-subtle);
    white-space: nowrap;
  }
  .case[aria-pressed='true'] {
    border-color: var(--border-strong);
    background: var(--bg);
    color: var(--text);
  }
</style>
