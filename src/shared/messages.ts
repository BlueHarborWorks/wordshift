import type { PatternSpec } from '../core/compile';

/**
 * Messages from the popup to the content script in one frame of a tab. The popup sends each one to
 * a single frame by frame id, and combines the replies when the page has several frames.
 */
export type PageRequest =
  | { type: 'quick:find'; spec: PatternSpec }
  | { type: 'quick:step'; delta: 1 | -1 }
  /** Makes match `index` of this frame the current one and scrolls to it; -1 clears it. */
  | { type: 'quick:focus'; index: number }
  | { type: 'quick:replaceOne'; spec: PatternSpec }
  | { type: 'quick:replaceAll'; spec: PatternSpec }
  | { type: 'quick:clear' }
  | { type: 'page:clearQuickChanges' }
  /** `frameId` routes the request to the frame that owns the action; the frame ignores it. */
  | { type: 'page:removeQuickChange'; actionId: number; frameId?: number }
  | { type: 'page:undo' }
  | { type: 'page:status' };

export interface QuickState {
  count: number;
  /** Index of the current match, or -1 when there are none. */
  current: number;
  error: string | null;
  warning: string | null;
}

export interface PageStatus {
  /** Automatic rules that changed something on this page. */
  autoRules: number;
  /** Their ids, so the popup can count rules once across frames. */
  autoRuleIds?: string[];
  autoReplacements: number;
  canUndo: boolean;
  paused: boolean;
  /** Tab-scoped Quick Replace actions still active on this page, oldest first. */
  quickActions: QuickAction[];
}

export interface QuickAction {
  /** Page-local undo action identifier. */
  id: number;
  find: string;
  replace: string;
  replacements: number;
  match: PatternSpec['match'];
  caseSensitive: boolean;
  mode: 'one' | 'all';
  /** Match position used to restore a single-replacement action after a reload. */
  matchIndex?: number;
  /** When the action was taken, so Undo picks the newest action across frames. */
  at?: number;
  /** The frame the action belongs to, set by the popup when it combines frames. */
  frameId?: number;
}

/**
 * Messages between a tab's content scripts and the background's tab-scoped Quick session store.
 * `url` is the sending frame's address; `top` is false for content inside an embedded frame.
 */
export type QuickSessionRequest =
  | { type: 'quickSession:get'; url: string; top?: boolean }
  | { type: 'quickSession:set'; url: string; top?: boolean; actions: QuickAction[] }
  | { type: 'tabState:set'; active: boolean };

export interface QuickSessionResponse {
  actions: QuickAction[];
}

export interface PageResponse {
  quick?: QuickState;
  replaced?: number;
  status: PageStatus;
}

export const CONTENT_SCRIPT_FILE = '/content-scripts/content.js';
export const AUTO_SCRIPT_ID = 'wordshift-auto';

export const HIGHLIGHT_CSS = `
::highlight(wordshift-match) { background-color: rgb(250 204 21 / 0.35); }
::highlight(wordshift-current) { background-color: rgb(250 204 21 / 0.95); color: #111; text-decoration: underline 2px; }
`;
