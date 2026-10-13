import type { PatternSpec } from '../core/compile';

/** Messages from the popup or background to the content script in a tab's top frame. */
export type PageRequest =
  | { type: 'quick:find'; spec: PatternSpec }
  | { type: 'quick:step'; delta: 1 | -1 }
  | { type: 'quick:replaceOne'; spec: PatternSpec }
  | { type: 'quick:replaceAll'; spec: PatternSpec }
  | { type: 'quick:clear' }
  | { type: 'page:clearQuickChanges' }
  | { type: 'page:removeQuickChange'; actionId: number }
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
}

/** Messages between a tab's content script and the background's tab-scoped Quick session store. */
export type QuickSessionRequest =
  | { type: 'quickSession:get'; url: string }
  | { type: 'quickSession:set'; url: string; actions: QuickAction[] }
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
