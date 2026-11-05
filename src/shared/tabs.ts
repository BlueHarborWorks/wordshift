import type { PatternSpec } from '../core/compile';
import {
  CONTENT_SCRIPT_FILE,
  HIGHLIGHT_CSS,
  type PageRequest,
  type PageResponse,
  type PageStatus,
  type QuickAction,
} from './messages';

/** Where match `index` falls when the frames' matches are counted in order, or null if out of range. */
export function locateMatch(counts: readonly number[], index: number): { frame: number; local: number } | null {
  if (index < 0) return null;
  let offset = 0;
  for (let frame = 0; frame < counts.length; frame++) {
    const count = counts[frame]!;
    if (index < offset + count) return { frame, local: index - offset };
    offset += count;
  }
  return null;
}

/**
 * Combines the frames' statuses into one for the popup: each automatic rule is counted once,
 * replacements are added up, and Quick actions are listed oldest first with their frame.
 */
export function combineStatus(frames: readonly { frameId: number; status: PageStatus }[]): PageStatus {
  const top = frames.find((f) => f.frameId === 0) ?? frames[0];
  const ruleIds = new Set<string>();
  let autoRules = 0;
  let autoReplacements = 0;
  let canUndo = false;
  const actions: { action: QuickAction; order: number }[] = [];
  for (const { frameId, status } of frames) {
    for (const id of status.autoRuleIds ?? []) ruleIds.add(id);
    autoRules = Math.max(autoRules, status.autoRules);
    autoReplacements += status.autoReplacements;
    canUndo ||= status.canUndo;
    for (const action of status.quickActions) actions.push({ action: { ...action, frameId }, order: actions.length });
  }
  actions.sort((a, b) => (a.action.at ?? 0) - (b.action.at ?? 0) || a.order - b.order);
  return {
    autoRules: Math.max(autoRules, ruleIds.size),
    autoRuleIds: [...ruleIds],
    autoReplacements,
    canUndo,
    paused: top?.status.paused ?? false,
    quickActions: actions.map((a) => a.action),
  };
}

/**
 * Quick Replace across every frame of a tab that Wordshift can reach, such as the embedded page in a
 * Google Sites page. The frames' matches form one list, in frame order, with one current match.
 */
export class PageFrames {
  /** Frame ids in search order; 0 is the top frame. */
  private frames: number[] = [0];
  private readonly replies = new Map<number, PageResponse>();
  /** Index of the current match across all frames, or -1. */
  private current = -1;
  private spec: PatternSpec | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly tabId: number) {}

  /**
   * Runs the content script in every frame Wordshift may access: the top frame through activeTab or
   * site access, and frames from other sites only with site access. Rejects on pages extensions
   * cannot access, such as browser settings pages and add-on stores. Injecting twice is harmless.
   */
  async prepare(): Promise<void> {
    const target = { tabId: this.tabId };
    let results: { frameId?: number; error?: unknown }[];
    try {
      results = await browser.scripting.executeScript({
        target: { ...target, allFrames: true },
        files: [CONTENT_SCRIPT_FILE],
      });
    } catch {
      results = await browser.scripting.executeScript({ target, files: [CONTENT_SCRIPT_FILE] });
    }
    const ids = results.filter((r) => r.error === undefined && r.frameId !== undefined).map((r) => r.frameId!);
    this.frames = [0, ...new Set(ids.filter((id) => id !== 0))];
    await browser.scripting
      .insertCSS({ target: { ...target, allFrames: true }, css: HIGHLIGHT_CSS })
      .catch(() => browser.scripting.insertCSS({ target, css: HIGHLIGHT_CSS }))
      .catch(() => undefined);
  }

  /** Highlights belong to the popup: each frame clears them when this port closes with the popup. */
  connect(): void {
    for (const frameId of this.frames) {
      try {
        browser.tabs.connect(this.tabId, { name: 'quick', frameId });
      } catch {
        // The frame is gone; it drops out on the next request.
      }
    }
  }

  /** Sends a popup request to the frames it concerns and returns one combined reply. */
  request(message: PageRequest): Promise<PageResponse> {
    const run = () => this.run(message);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async run(message: PageRequest): Promise<PageResponse> {
    let replaced: number | undefined;
    switch (message.type) {
      case 'quick:find': {
        const prev = this.spec;
        const sameSearch =
          prev !== null &&
          prev.find === message.spec.find &&
          prev.match === message.spec.match &&
          prev.caseSensitive === message.spec.caseSensitive;
        this.spec = message.spec;
        await this.sendAll(message);
        this.current = sameSearch ? Math.max(0, this.current) : 0;
        await this.focus();
        break;
      }
      case 'quick:step': {
        const total = this.total();
        if (total > 0) this.current = (Math.max(0, this.current) + message.delta + total) % total;
        await this.focus();
        break;
      }
      case 'quick:replaceOne': {
        const target = this.target();
        replaced = target ? ((await this.send(target.frameId, message))?.replaced ?? 0) : 0;
        await this.focus();
        break;
      }
      case 'quick:replaceAll':
        replaced = sum(await this.sendAll(message));
        this.current = 0;
        await this.focus();
        break;
      case 'quick:clear':
        this.spec = null;
        this.current = -1;
        await this.sendAll(message);
        break;
      case 'page:undo': {
        const frameId = this.newestActionFrame();
        replaced = frameId === undefined ? 0 : ((await this.send(frameId, message))?.replaced ?? 0);
        await this.focus();
        break;
      }
      case 'page:clearQuickChanges':
        replaced = sum(await this.sendAll(message));
        await this.focus();
        break;
      case 'page:removeQuickChange':
        replaced = (await this.send(message.frameId ?? 0, message))?.replaced ?? 0;
        await this.focus();
        break;
      case 'quick:focus':
      case 'page:status':
        await this.sendAll({ type: 'page:status' });
        break;
    }
    return this.combined(replaced);
  }

  private async send(frameId: number, message: PageRequest): Promise<PageResponse | null> {
    try {
      const response = (await browser.tabs.sendMessage(this.tabId, message, { frameId })) as PageResponse | undefined;
      if (response) {
        this.replies.set(frameId, response);
        return response;
      }
    } catch {
      // Handled below.
    }
    if (frameId === 0) throw new Error('No response from page.');
    // An embedded frame that navigated away or was removed drops out of the search.
    this.frames = this.frames.filter((id) => id !== frameId);
    this.replies.delete(frameId);
    return null;
  }

  private sendAll(message: PageRequest): Promise<(PageResponse | null)[]> {
    return Promise.all(this.frames.map((frameId) => this.send(frameId, message)));
  }

  private counts(): number[] {
    return this.frames.map((id) => this.replies.get(id)?.quick?.count ?? 0);
  }

  private total(): number {
    return this.counts().reduce((a, b) => a + b, 0);
  }

  /** The frame and frame-local index of the current match. */
  private target(): { frameId: number; local: number } | null {
    const total = this.total();
    if (total === 0) return null;
    this.current = Math.min(Math.max(0, this.current), total - 1);
    const found = locateMatch(this.counts(), this.current);
    return found ? { frameId: this.frames[found.frame]!, local: found.local } : null;
  }

  /** Marks the current match in its frame and scrolls to it; other frames show no current match. */
  private async focus(): Promise<void> {
    const target = this.target();
    if (!target) this.current = -1;
    await Promise.all(
      [...this.frames].map((frameId) => {
        const index = target && target.frameId === frameId ? target.local : -1;
        const shown = this.replies.get(frameId)?.quick?.current ?? -1;
        if (index === -1 && shown === -1) return null;
        return this.send(frameId, { type: 'quick:focus', index });
      }),
    );
  }

  /** The frame whose newest Quick action is the most recent, for Undo. */
  private newestActionFrame(): number | undefined {
    let best: { frameId: number; at: number } | undefined;
    for (const frameId of this.frames) {
      const status = this.replies.get(frameId)?.status;
      if (!status?.canUndo) continue;
      const at = Math.max(0, ...status.quickActions.map((a) => a.at ?? 0));
      if (!best || at > best.at) best = { frameId, at };
    }
    return best?.frameId;
  }

  private combined(replaced: number | undefined): PageResponse {
    const top = this.replies.get(0);
    const total = this.total();
    if (total === 0) this.current = -1;
    const statuses = this.frames.flatMap((frameId) => {
      const status = this.replies.get(frameId)?.status;
      return status ? [{ frameId, status }] : [];
    });
    return {
      quick: {
        count: total,
        current: total === 0 ? -1 : Math.min(Math.max(0, this.current), total - 1),
        error: top?.quick?.error ?? null,
        warning: top?.quick?.warning ?? null,
      },
      replaced,
      status: combineStatus(statuses),
    };
  }
}

function sum(responses: readonly (PageResponse | null)[]): number {
  return responses.reduce((total, r) => total + (r?.replaced ?? 0), 0);
}
