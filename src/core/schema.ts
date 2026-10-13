import { compilePattern } from './compile';
import { sitePatternError } from './sites';
import { SCHEMA_VERSION, type Group, type Library, type MatchMode, type ReviewReason, type Rule } from './types';

export interface Issue {
  /** JSON path of the offending value, such as `rules[3].find`. */
  path: string;
  message: string;
  /** `error`: the item was dropped. `warning`: the item was kept but changed or disabled. */
  severity: 'error' | 'warning';
}

export type ParseResult = { ok: true; library: Library; issues: Issue[] } | { ok: false; issues: Issue[] };

export function newId(): string {
  return crypto.randomUUID();
}

/** Upgrades a document from version N to N + 1. Keyed by N. */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {
  1: (doc) => ({
    ...doc,
    schemaVersion: 2,
    rules: Array.isArray(doc.rules)
      ? doc.rules.map((raw) => {
          if (!isObject(raw)) return raw;
          const { apply, ...rule } = raw;
          if (!isObject(apply) || apply.auto !== false) return rule;
          return {
            ...rule,
            enabled: false,
            review: typeof rule.review === 'string' ? rule.review : 'manual-only',
            legacy: { ...(isObject(rule.legacy) ? rule.legacy : {}), previousMode: 'manual-only' },
          };
        })
      : doc.rules,
  }),
};

const MATCH_MODES: readonly MatchMode[] = ['text', 'word', 'regex'];
const REVIEW_REASONS: readonly ReviewReason[] = [
  'function-output',
  'html-mode',
  'site-pattern',
  'invalid-pattern',
  'manual-only',
];

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : null;
}

/**
 * Validates and normalizes a stored or imported Wordshift document.
 * Never throws: problems are reported as issues with a path.
 */
export function parseLibrary(input: unknown): ParseResult {
  const issues: Issue[] = [];
  const fail = (path: string, message: string): ParseResult => ({
    ok: false,
    issues: [{ path, message, severity: 'error' }],
  });

  if (!isObject(input)) return fail('', 'Expected a JSON object.');
  if (input.format !== 'wordshift') return fail('format', 'This is not a Wordshift file.');

  let version = input.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return fail('schemaVersion', 'Missing or invalid schema version.');
  }
  if (version > SCHEMA_VERSION) {
    return fail(
      'schemaVersion',
      `This file was made by a newer version of Wordshift (schema ${version}). Update Wordshift and try again.`,
    );
  }

  let doc: Obj = input;
  while (version < SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) return fail('schemaVersion', `No upgrade path from schema ${version}.`);
    doc = migrate(doc);
    version++;
  }

  if (!Array.isArray(doc.groups)) return fail('groups', 'Expected a list of groups.');
  if (!Array.isArray(doc.rules)) return fail('rules', 'Expected a list of rules.');

  const groups: Group[] = [];
  const groupIds = new Set<string>();
  doc.groups.forEach((raw, i) => {
    const path = `groups[${i}]`;
    if (!isObject(raw) || typeof raw.name !== 'string') {
      issues.push({ path, message: 'Group needs a name; group skipped.', severity: 'error' });
      return;
    }
    let id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : '';
    if (id === '' || groupIds.has(id)) {
      id = newId();
      issues.push({
        path: `${path}.id`,
        message: 'Missing or duplicate id; a new one was assigned.',
        severity: 'warning',
      });
    }
    groupIds.add(id);
    groups.push({ id, name: raw.name, enabled: raw.enabled !== false });
  });

  const rules: Rule[] = [];
  const ruleIds = new Set<string>();
  doc.rules.forEach((raw, i) => {
    const path = `rules[${i}]`;
    const rule = parseRule(raw, path, groupIds, issues);
    if (!rule) return;
    if (ruleIds.has(rule.id)) {
      rule.id = newId();
      issues.push({ path: `${path}.id`, message: 'Duplicate id; a new one was assigned.', severity: 'warning' });
    }
    ruleIds.add(rule.id);
    rules.push(rule);
  });

  return { ok: true, library: { format: 'wordshift', schemaVersion: SCHEMA_VERSION, groups, rules }, issues };
}

function parseRule(raw: unknown, path: string, groupIds: ReadonlySet<string>, issues: Issue[]): Rule | null {
  const drop = (field: string, message: string): null => {
    issues.push({ path: field ? `${path}.${field}` : path, message: `${message} Rule skipped.`, severity: 'error' });
    return null;
  };
  const warn = (field: string, message: string) => {
    issues.push({ path: `${path}.${field}`, message, severity: 'warning' });
  };

  if (!isObject(raw)) return drop('', 'Expected an object.');
  if (typeof raw.find !== 'string' || raw.find === '') return drop('find', 'Find text is missing.');
  if (typeof raw.replace !== 'string') return drop('replace', 'Replace text is missing.');
  if (!MATCH_MODES.includes(raw.match as MatchMode)) return drop('match', 'Match must be text, word, or regex.');

  const sites = isObject(raw.sites) ? raw.sites : {};
  const include = sites.include === undefined ? [] : stringList(sites.include);
  const exclude = sites.exclude === undefined ? [] : stringList(sites.exclude);
  if (!include) return drop('sites.include', 'Expected a list of site patterns.');
  if (!exclude) return drop('sites.exclude', 'Expected a list of site patterns.');

  let groupId = typeof raw.groupId === 'string' ? raw.groupId : null;
  if (groupId !== null && !groupIds.has(groupId)) {
    warn('groupId', 'Unknown group; rule moved out of its group.');
    groupId = null;
  }

  const rule: Rule = {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : newId(),
    groupId,
    enabled: raw.enabled !== false,
    find: raw.find,
    replace: raw.replace,
    match: raw.match as MatchMode,
    caseSensitive: raw.caseSensitive === true,
    sites: { include, exclude },
    review: REVIEW_REASONS.includes(raw.review as ReviewReason) ? (raw.review as ReviewReason) : null,
  };
  if (raw.legacy !== undefined) rule.legacy = raw.legacy;

  [...include, ...exclude].forEach((pattern) => {
    const error = sitePatternError(pattern);
    if (error) warn('sites', `"${pattern}": ${error}`);
  });

  const compiled = compilePattern(rule);
  if (!compiled.ok) {
    warn('find', `${compiled.error} Rule disabled.`);
    rule.enabled = false;
    rule.review = 'invalid-pattern';
  }
  return rule;
}
