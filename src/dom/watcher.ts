import { collectTextNodes, isEligibleText } from './textnodes';

export interface WatcherOptions {
  /** Wait this long after the last mutation before reporting. */
  debounceMs?: number;
  /** Report at least this often while the page keeps changing. */
  maxWaitMs?: number;
}

/**
 * Batches DOM mutations into lists of new or changed text nodes.
 * Nodes for which `ignore` returns true (Wordshift's own writes) are left out, which prevents loops.
 */
export class ContentWatcher {
  private readonly observer: MutationObserver;
  private readonly pending = new Set<Text>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private firstPendingAt = 0;
  private readonly roots = new Set<Node>();
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;

  constructor(
    private readonly onNodes: (nodes: Text[]) => void,
    private readonly ignore: (node: Text) => boolean,
    options: WatcherOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 150;
    this.maxWaitMs = options.maxWaitMs ?? 1000;
    this.observer = new MutationObserver((records) => this.collect(records));
  }

  /** Watches a document or shadow root. Safe to call more than once per root. */
  observe(root: Node): void {
    if (this.roots.has(root)) return;
    this.roots.add(root);
    this.observer.observe(root, { childList: true, subtree: true, characterData: true });
  }

  /** Drops mutations queued so far, such as those caused by Wordshift restoring text. */
  discardPending(): void {
    this.collect(this.observer.takeRecords());
    this.pending.clear();
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  disconnect(): void {
    this.discardPending();
    this.observer.disconnect();
    this.roots.clear();
  }

  private collect(records: MutationRecord[]): void {
    for (const record of records) {
      if (record.type === 'characterData') {
        const node = record.target as Text;
        if (node.isConnected && !this.ignore(node) && isEligibleText(node)) this.pending.add(node);
        continue;
      }
      for (const added of record.addedNodes) {
        for (const node of collectTextNodes(added, (shadow) => this.observe(shadow))) {
          if (!this.ignore(node)) this.pending.add(node);
        }
      }
    }
    if (this.pending.size > 0) this.schedule();
  }

  private schedule(): void {
    const now = Date.now();
    if (this.timer === undefined) this.firstPendingAt = now;
    clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(this.debounceMs, this.firstPendingAt + this.maxWaitMs - now));
    this.timer = setTimeout(() => this.flush(), wait);
  }

  private flush(): void {
    this.timer = undefined;
    const nodes = [...this.pending].filter((n) => n.isConnected);
    this.pending.clear();
    if (nodes.length > 0) this.onNodes(nodes);
  }
}
