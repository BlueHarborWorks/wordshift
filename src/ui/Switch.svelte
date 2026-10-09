<script lang="ts">
  interface Props {
    checked: boolean;
    label: string;
    /** Hide the label visually but keep it for screen readers. */
    hideLabel?: boolean;
    disabled?: boolean;
    onchange?: (checked: boolean) => void;
  }

  let { checked, label, hideLabel = false, disabled = false, onchange }: Props = $props();
</script>

<label class="switch" class:disabled>
  <input type="checkbox" role="switch" {checked} {disabled} onchange={(e) => onchange?.(e.currentTarget.checked)} />
  <span class="track" aria-hidden="true"><span class="thumb"></span></span>
  <span class:visually-hidden={hideLabel}>{label}</span>
</label>

<style>
  .switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .switch.disabled {
    cursor: default;
    opacity: 0.5;
  }
  input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
  .track {
    position: relative;
    flex: none;
    width: 28px;
    height: 16px;
    border-radius: 8px;
    background: var(--border-strong);
    transition: background 120ms;
  }
  .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--bg);
    transition: transform 120ms;
  }
  input:checked + .track {
    background: var(--primary);
  }
  input:checked + .track .thumb {
    transform: translateX(12px);
  }
  input:focus-visible + .track {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
</style>
