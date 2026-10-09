/** How the `find` text of a rule is interpreted. */
export type MatchMode = 'text' | 'word' | 'regex';

/** Why an imported rule was disabled and needs the user's attention. */
export type ReviewReason = 'function-output' | 'html-mode' | 'site-pattern' | 'invalid-pattern';

export interface SiteScope {
  /** Empty means every site. */
  include: string[];
  /** Exclusions always win over inclusions. */
  exclude: string[];
}

export interface Rule {
  id: string;
  groupId: string | null;
  enabled: boolean;
  find: string;
  replace: string;
  match: MatchMode;
  caseSensitive: boolean;
  sites: SiteScope;
  /** `auto` runs on page load and on new content; `manual` runs on "Apply rules now". */
  apply: { auto: boolean; manual: boolean };
  review: ReviewReason | null;
  /** Original data kept from an import when the rule could not be converted faithfully. */
  legacy?: unknown;
}

export interface Group {
  id: string;
  name: string;
  enabled: boolean;
}

export const SCHEMA_VERSION = 1;

/** The persisted rule set, and the export file format. Rule order is array order. */
export interface Library {
  format: 'wordshift';
  schemaVersion: typeof SCHEMA_VERSION;
  groups: Group[];
  rules: Rule[];
}

export interface Settings {
  /** Master switch for automatic rules. */
  autoApply: boolean;
  /** Hostnames where Wordshift does nothing. */
  pausedSites: string[];
}

export const DEFAULT_SETTINGS: Settings = { autoApply: true, pausedSites: [] };

export function emptyLibrary(): Library {
  return { format: 'wordshift', schemaVersion: SCHEMA_VERSION, groups: [], rules: [] };
}
