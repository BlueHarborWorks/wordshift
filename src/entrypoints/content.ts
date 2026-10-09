import { compilePattern, type PatternSpec } from '../core/compile';
import type { Library, Settings } from '../core/types';
import { PageReplacer, type NodeMatch } from '../dom/replacer';
import { collectTextNodes } from '../dom/textnodes';
import { ContentWatcher } from '../dom/watcher';
import type { PageRequest, PageResponse, PageStatus, QuickState } from '../shared/messages';
import { isPaused, rulesFor } from '../shared/rules';
import { loadLibrary, loadSettings, onDataChanged } from '../shared/storage';

declare global {
  interface Window {
    __wordshift?: boolean;
  }
}

export default defineContentScript({
  // Registered at runtime by the background for sites the user allowed, and injected on demand
  // by the popup through activeTab. Empty matches keep WXT from adding host permissions.
  registration: 'runtime',
  matches: [],
  main() {
    // The popup may inject this script into a frame where it is already running.
    if (window.__wordshift) return;
    window.__wordshift = true;
    void new PageController().start();
  },
});

const MATCH_HIGHLIGHT = 'wordshift-match';
const CURRENT_HIGHLIGHT = 'wordshift-current';

class PageController {
  private readonly replacer = new PageReplacer();
  private readonly watcher = new ContentWatcher(
    (nodes) => void this.applyAuto(nodes),
    (node) => this.replacer.isOwnWrite(node),
  );
  private library: Library | null = null;
  private settings: Settings | null = null;
  private autoActive = false;
  /** Identifies the automatic rule set last applied, so unrelated storage changes do not redo the page. */
  private autoKey = '';
  /** Bumped whenever the rule set changes; passes started under an older value stop at their next yield. */
  private generation = 0;
  private reloading: Promise<void> = Promise.resolve();
  private quick: { matches: NodeMatch[]; current: number; error: string | null; warning: string | null } = {
    matches: [],
    current: -1,
    error: null,
    warning: null,
  };
  private quickSpec: PatternSpec | null = null;

  async start(): Promise<void> {
    browser.runtime.onMessage.addListener((message: PageRequest, _sender, sendResponse) => {
      // Quick Replace and manual rules work on the top frame only.
      if (window !== window.top) return false;
      void this.handle(message).then(sendResponse);
      return true;
    });
    // The popup holds this port open; when it closes, its highlights go with it.
    browser.runtime.onConnect.addListener((port) => {
      if (port.name === 'quick') port.onDisconnect.addListener(() => void this.handle({ type: 'quick:clear' }));
    });
    onDataChanged(() => void this.reload());
    await this.reload();
  }

  /** Reloads rules and settings. Calls are queued so two reloads never work on the page at once. */
  private reload(): Promise<void> {
    const run = () => this.doReload();
    this.reloading = this.reloading.then(run, run);
    return this.reloading;
  }

  private async doReload(): Promise<void> {
    [{ library: this.library }, this.settings] = await Promise.all([loadLibrary(), loadSettings()]);

    const rules = this.autoRules();
    const key = rules.map((r) => r.key).join('\n');
    if (key === this.autoKey) return;
    this.autoKey = key;
    this.generation++;

    // Start over so edited or removed rules stop affecting the page.
    if (this.autoActive) {
      this.replacer.restoreAuto();
      this.watcher.discardPending();
    }

    this.autoActive = rules.length > 0;
    if (!this.autoActive) {
      this.watcher.disconnect();
      return;
    }
    await this.applyAuto(collectTextNodes(document, (root) => this.watcher.observe(root)));
    this.watcher.observe(document);
  }

  private autoRules() {
    if (!this.library || !this.settings?.autoApply || isPaused(this.settings, location.href)) return [];
    return rulesFor(this.library, location.href, 'auto');
  }

  private async applyAuto(nodes: Text[]): Promise<void> {
    const rules = this.autoRules();
    if (rules.length === 0) return;
    const generation = this.generation;
    await this.replacer.applyAuto(nodes, rules, { cancelled: () => generation !== this.generation });
  }

  private async handle(message: PageRequest): Promise<PageResponse> {
    switch (message.type) {
      case 'quick:find':
        this.setQuickSpec(message.spec);
        return { quick: this.quickState(), status: this.status() };

      case 'quick:step': {
        const count = this.quick.matches.length;
        if (count > 0) this.quick.current = (this.quick.current + message.delta + count) % count;
        this.showQuick(true);
        return { quick: this.quickState(), status: this.status() };
      }

      case 'quick:replaceOne': {
        this.setQuickSpec(message.spec);
        const match = this.quick.matches[this.quick.current];
        const replaced = match ? this.replacer.replaceMatches([match]) : 0;
        this.findQuick(this.quick.current);
        return { quick: this.quickState(), replaced, status: this.status() };
      }

      case 'quick:replaceAll': {
        this.setQuickSpec(message.spec);
        const replaced = this.replacer.replaceMatches(this.quick.matches);
        this.findQuick(0);
        return { quick: this.quickState(), replaced, status: this.status() };
      }

      case 'quick:clear':
        this.quickSpec = null;
        this.quick = { matches: [], current: -1, error: null, warning: null };
        this.showQuick(false);
        return { quick: this.quickState(), status: this.status() };

      case 'page:applyManual': {
        if (!this.library) await this.reload();
        const rules = this.library ? rulesFor(this.library, location.href, 'manual') : [];
        const nodes = collectTextNodes(document);
        const action = this.replacer.newAction();
        let replaced = 0;
        for (const rule of rules)
          replaced += this.replacer.replaceMatches(this.replacer.find(nodes, rule.pattern), action);
        if (this.quickSpec) this.findQuick(0);
        return { replaced, status: this.status() };
      }

      case 'page:undo': {
        const restored = this.replacer.undoLast();
        this.watcher.discardPending();
        if (this.quickSpec) this.findQuick(Math.max(0, this.quick.current));
        return { replaced: restored, quick: this.quickState(), status: this.status() };
      }

      case 'page:status':
        return { quick: this.quickState(), status: this.status() };
    }
  }

  /**
   * Updates the search. Matches carry their replacement text, so any change re-runs the search;
   * the position is kept unless what is being searched for changed.
   */
  private setQuickSpec(spec: PatternSpec): void {
    const prev = this.quickSpec;
    const sameSearch =
      prev !== null &&
      prev.find === spec.find &&
      prev.match === spec.match &&
      prev.caseSensitive === spec.caseSensitive;
    if (sameSearch && prev.replace === spec.replace) return;
    this.quickSpec = spec;
    this.findQuick(sameSearch ? Math.max(0, this.quick.current) : 0);
  }

  /** Re-runs the Quick Replace search, keeping the current position where possible. */
  private findQuick(preferredIndex: number): void {
    this.quick = { matches: [], current: -1, error: null, warning: null };
    if (!this.quickSpec || this.quickSpec.find === '') {
      this.showQuick(false);
      return;
    }
    const compiled = compilePattern(this.quickSpec);
    if (!compiled.ok) {
      this.quick.error = compiled.error;
      this.showQuick(false);
      return;
    }
    this.quick.warning = compiled.warnings[0] ?? null;
    // The tab title is not on the page, so it cannot be highlighted or stepped to.
    const nodes = collectTextNodes(document, undefined, { includeTitle: false });
    this.quick.matches = this.replacer.find(nodes, compiled.pattern);
    if (this.quick.matches.length > 0) {
      this.quick.current = Math.min(preferredIndex, this.quick.matches.length - 1);
    }
    this.showQuick(true);
  }

  private showQuick(scroll: boolean): void {
    // The Custom Highlight API marks matches without changing the page's DOM.
    if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
    CSS.highlights.delete(MATCH_HIGHLIGHT);
    CSS.highlights.delete(CURRENT_HIGHLIGHT);

    const { matches, current } = this.quick;
    if (matches.length === 0) return;

    const ranges = matches.map((m) => {
      const range = document.createRange();
      range.setStart(m.node, m.start);
      range.setEnd(m.node, m.end);
      return range;
    });
    const currentRange = ranges[current];
    CSS.highlights.set(MATCH_HIGHLIGHT, new Highlight(...ranges.filter((r) => r !== currentRange)));
    if (!currentRange) return;
    CSS.highlights.set(CURRENT_HIGHLIGHT, new Highlight(currentRange));

    if (scroll) {
      const rect = currentRange.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) {
        window.scrollBy({ top: rect.top - window.innerHeight / 2, behavior: 'instant' });
      }
    }
  }

  private quickState(): QuickState {
    return {
      count: this.quick.matches.length,
      current: this.quick.current,
      error: this.quick.error,
      warning: this.quick.warning,
    };
  }

  private status(): PageStatus {
    let autoReplacements = 0;
    for (const n of this.replacer.autoCounts.values()) autoReplacements += n;
    return {
      autoRules: this.replacer.autoCounts.size,
      autoReplacements,
      manualRules: this.library ? rulesFor(this.library, location.href, 'manual').length : 0,
      canUndo: this.replacer.canUndo,
      paused: this.settings !== null && isPaused(this.settings, location.href),
    };
  }
}
