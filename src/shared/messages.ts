import type { PatternSpec } from '../core/compile';

/** Messages from the popup or background to the content script in a tab's top frame. */
export type PageRequest =
  | { type: 'quick:find'; spec: PatternSpec }
  | { type: 'quick:step'; delta: 1 | -1 }
  | { type: 'quick:replaceOne'; spec: PatternSpec }
  | { type: 'quick:replaceAll'; spec: PatternSpec }
  | { type: 'quick:clear' }
  | { type: 'page:applyManual' }
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
  /** Manual rules that cover this page, whether or not they match anything. */
  manualRules: number;
  canUndo: boolean;
  paused: boolean;
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
