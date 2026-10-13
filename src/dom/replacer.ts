import { findMatches, spliceMatches, type TextMatch } from '../core/apply';
import type { CompiledPattern } from '../core/compile';

export interface ActiveRule {
  id: string;
  /** Changes whenever the rule's matching or replacement changes. */
  key: string;
  pattern: CompiledPattern;
}

export interface PassResult {
  replacements: number;
  nodesChanged: number;
  /** True when the pass stopped early at the node limit. */
  truncated: boolean;
}

export interface NodeMatch extends TextMatch {
  node: Text;
}

interface Change {
  node: Text;
  before: string;
  after: string;
  /** 0 for automatic rules; each Quick Replace action gets its own number so it can be undone alone. */
  action: number;
  /** Exact replacements for replaying a later Quick action after an earlier one is removed. */
  edits?: ChangeEdit[];
}

interface ChangeEdit {
  start: number;
  end: number;
  replacement: string;
}

export interface ReplacerOptions {
  /** Work for this long, then yield to the page before continuing. */
  sliceMs?: number;
  /** Stop a pass after this many text nodes. */
  maxNodes?: number;
  now?: () => number;
  yieldToPage?: () => Promise<void>;
}

export interface PassOptions {
  /** Checked after every yield; a pass stops early when it returns true. */
  cancelled?: () => boolean;
}

const AUTO = 0;

/*
 * Some pages rewrite text Wordshift changed (a framework re-rendering its own state, a ticker).
 * Each rewrite comes back through the watcher, so without a limit the two would alternate forever.
 * A node written this many times inside the window is left alone from then on.
 */
const FIGHT_LIMIT = 6;
const FIGHT_WINDOW_MS = 10_000;

/**
 * Changes text nodes and remembers every change so it can be undone.
 * Only touches `Text.data`, so page structure, listeners and framework state are left intact.
 */
export class PageReplacer {
  private changes: Change[] = [];
  /** What Wordshift last wrote to each node, so its own writes are not processed again. */
  private written = new WeakMap<Text, string>();
  /** Automatic writes per node inside the current window, to spot pages that keep undoing them. */
  private fights = new WeakMap<Text, { count: number; since: number }>();
  private lastAction = AUTO;
  private readonly perRule = new Map<string, number>();

  private readonly sliceMs: number;
  private readonly maxNodes: number;
  private readonly now: () => number;
  private readonly yieldToPage: () => Promise<void>;

  constructor(options: ReplacerOptions = {}) {
    this.sliceMs = options.sliceMs ?? 12;
    this.maxNodes = options.maxNodes ?? 200_000;
    this.now = options.now ?? (() => performance.now());
    this.yieldToPage = options.yieldToPage ?? (() => new Promise((resolve) => setTimeout(resolve, 0)));
  }

  /** Replacements made by automatic rules, by rule id. */
  get autoCounts(): ReadonlyMap<string, number> {
    return this.perRule;
  }

  get canUndo(): boolean {
    return this.changes.some((c) => c.action !== AUTO);
  }

  /** True when the node's current text was written by Wordshift. */
  isOwnWrite(node: Text): boolean {
    return this.written.get(node) === node.data;
  }

  /** Applies automatic rules to the given nodes, yielding to the page between slices. */
  async applyAuto(
    nodes: readonly Text[],
    rules: readonly ActiveRule[],
    options: PassOptions = {},
  ): Promise<PassResult> {
    const result: PassResult = { replacements: 0, nodesChanged: 0, truncated: nodes.length > this.maxNodes };
    const limit = Math.min(nodes.length, this.maxNodes);
    let sliceStart = this.now();

    for (let i = 0; i < limit; i++) {
      if (this.now() - sliceStart > this.sliceMs) {
        await this.yieldToPage();
        if (options.cancelled?.()) return result;
        sliceStart = this.now();
      }
      const node = nodes[i]!;
      if (!node.isConnected || this.isOwnWrite(node) || this.isFighting(node)) continue;

      let text = node.data;
      let changed = 0;
      for (const rule of rules) {
        const matches = findMatches(text, rule.pattern);
        if (matches.length === 0) continue;
        text = spliceMatches(text, matches);
        changed += matches.length;
        this.perRule.set(rule.id, (this.perRule.get(rule.id) ?? 0) + matches.length);
      }
      if (changed > 0) {
        this.write(node, text, AUTO);
        result.replacements += changed;
        result.nodesChanged++;
      }
    }
    return result;
  }

  private isFighting(node: Text): boolean {
    const now = Date.now();
    const entry = this.fights.get(node);
    if (!entry || now - entry.since > FIGHT_WINDOW_MS) {
      this.fights.set(node, { count: 1, since: now });
      return false;
    }
    entry.count++;
    return entry.count > FIGHT_LIMIT;
  }

  /** Every match of one pattern, for preview and step-through. Includes text Wordshift already changed. */
  find(nodes: readonly Text[], pattern: CompiledPattern): NodeMatch[] {
    const out: NodeMatch[] = [];
    for (const node of nodes) {
      if (!node.isConnected) continue;
      for (const match of findMatches(node.data, pattern)) out.push({ ...match, node });
    }
    return out;
  }

  /** Starts a new undoable action, for grouping several `replaceMatches` calls. */
  newAction(): number {
    return ++this.lastAction;
  }

  /**
   * Replaces the given matches as one undoable action (a new one unless `action` is given).
   * Matches must come from `find` on the current text.
   */
  replaceMatches(matches: readonly NodeMatch[], action?: number): number {
    const byNode = new Map<Text, NodeMatch[]>();
    for (const match of matches) {
      if (!match.node.isConnected) continue;
      const list = byNode.get(match.node) ?? [];
      list.push(match);
      byNode.set(match.node, list);
    }
    if (byNode.size === 0) return 0;

    action ??= this.newAction();
    this.lastAction = Math.max(this.lastAction, action);
    let count = 0;
    for (const [node, list] of byNode) {
      list.sort((a, b) => a.start - b.start);
      const edits = list.map(({ start, end, replacement }) => ({ start, end, replacement }));
      this.write(node, spliceMatches(node.data, list), action, edits);
      count += list.length;
    }
    return count;
  }

  /** Undoes the most recent Quick Replace action. Returns the number of nodes restored. */
  undoLast(): number {
    const action = Math.max(AUTO, ...this.changes.map((c) => c.action));
    if (action === AUTO) return 0;
    return this.restoreAction(action);
  }

  /** Restores one Quick Replace action while leaving the other actions in place. */
  restoreAction(action: number): number {
    if (action === AUTO) return 0;
    const affected = new Set(this.changes.filter((change) => change.action === action).map((change) => change.node));
    let restored = 0;

    for (const node of affected) {
      const nodeChanges = this.changes.filter((change) => change.node === node);
      const latest = nodeChanges.at(-1);
      // The page owns text it rewrote after Wordshift; do not overwrite it to remove history.
      if (!node.isConnected || !latest || node.data !== latest.after) continue;

      let text = nodeChanges[0]!.before;
      for (const change of nodeChanges) {
        if (change.action === action) continue;
        const before = text;
        const replayed = this.replay(change, text);
        text = replayed.text;
        // Rebase the remaining undo stack onto the text that no longer contains the removed action.
        change.before = before;
        change.after = text;
        change.edits = replayed.edits;
      }

      if (node.data !== text) {
        node.data = text;
        restored++;
      }
      if (nodeChanges.some((change) => change.action !== action)) this.written.set(node, text);
      else this.written.delete(node);
    }

    this.changes = this.changes.filter((change) => change.action !== action);
    return restored;
  }

  /** Restores text changed by automatic rules, leaving Quick Replace changes in place. */
  restoreAuto(): number {
    const restored = this.restore((c) => c.action === AUTO);
    this.perRule.clear();
    return restored;
  }

  /** Restores every Quick Replace action, leaving automatic changes in place. */
  restoreQuick(): number {
    return this.restore((c) => c.action !== AUTO);
  }

  /** Restores all text Wordshift changed on this page. */
  restoreAll(): number {
    const restored = this.restore(() => true);
    this.perRule.clear();
    return restored;
  }

  private write(node: Text, text: string, action: number, edits?: ChangeEdit[]): void {
    this.changes.push({ node, before: node.data, after: text, action, edits });
    node.data = text;
    this.written.set(node, text);
  }

  /** Reapplies a Quick action to text rebased by removing an earlier action. */
  private replay(change: Change, text: string): { text: string; edits: ChangeEdit[] | undefined } {
    if (text === change.before) return { text: change.after, edits: change.edits };
    if (!change.edits) return { text, edits: undefined };

    const applied: ChangeEdit[] = [];
    for (const edit of [...change.edits].sort((a, b) => b.start - a.start)) {
      const expected = change.before.slice(edit.start, edit.end);
      if (expected === '') continue;
      const near = this.mapPosition(change.before, text, edit.start);
      const start = this.nearestOccurrence(text, expected, near);
      if (start === -1) continue;
      const end = start + expected.length;
      text = text.slice(0, start) + edit.replacement + text.slice(end);
      applied.push({ start, end, replacement: edit.replacement });
    }
    applied.sort((a, b) => a.start - b.start);
    return { text, edits: applied };
  }

  private mapPosition(from: string, to: string, position: number): number {
    let prefix = 0;
    while (prefix < from.length && prefix < to.length && from[prefix] === to[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < from.length - prefix &&
      suffix < to.length - prefix &&
      from[from.length - 1 - suffix] === to[to.length - 1 - suffix]
    )
      suffix++;
    if (position <= prefix) return position;
    if (position >= from.length - suffix) return to.length - (from.length - position);
    const fromMiddle = Math.max(1, from.length - prefix - suffix);
    const toMiddle = Math.max(0, to.length - prefix - suffix);
    return prefix + Math.round(((position - prefix) / fromMiddle) * toMiddle);
  }

  private nearestOccurrence(text: string, search: string, near: number): number {
    let best = -1;
    let distance = Number.POSITIVE_INFINITY;
    for (let start = text.indexOf(search); start !== -1; start = text.indexOf(search, start + 1)) {
      const candidateDistance = Math.abs(start - near);
      if (candidateDistance < distance) {
        best = start;
        distance = candidateDistance;
      }
    }
    return best;
  }

  private restore(select: (change: Change) => boolean): number {
    let restored = 0;
    const kept: Change[] = [];
    for (let i = this.changes.length - 1; i >= 0; i--) {
      const change = this.changes[i]!;
      if (!select(change)) {
        kept.push(change);
        continue;
      }
      // Skip nodes the page has rewritten since; restoring them would clobber newer content.
      if (change.node.isConnected && change.node.data === change.after) {
        change.node.data = change.before;
        // The text now showing may still be an earlier Wordshift write (auto rule under a Quick Replace).
        const earlier = this.changes
          .slice(0, i)
          .some((c) => c.node === change.node && c.after === change.before && !select(c));
        if (earlier) this.written.set(change.node, change.before);
        else this.written.delete(change.node);
        restored++;
      } else {
        // A kept change can sit on top of the change being removed (for example, Quick Replace
        // over an automatic rule). Rebase that kept change so undoing it later reaches the text
        // from before the removed layer instead of resurrecting it.
        const next = this.changes
          .slice(i + 1)
          .find((later) => later.node === change.node && !select(later) && later.before === change.after);
        if (next) next.before = change.before;
      }
    }
    this.changes = kept.reverse();
    return restored;
  }
}
