import { compilePattern } from './compile';
import { newId, type Issue } from './schema';
import { SCHEMA_VERSION, type Group, type Library, type MatchMode, type Rule } from './types';

/*
 * Converts a FoxReplace export file (format versions 0.14, 0.15, 2.1, 2.6) into a Wordshift library.
 * Written from the documented JSON format; shares no code with FoxReplace.
 *
 * Capabilities Wordshift does not support (function output, HTML modes) are imported disabled,
 * marked for review, with the original values kept in `legacy`.
 */

const SUPPORTED_VERSIONS = ['0.14', '0.15', '2.1', '2.6'];

const MATCH_BY_INPUT_TYPE: Record<string, MatchMode> = { text: 'text', wholewords: 'word', regexp: 'regex' };

export type FoxReplaceResult =
  | { ok: true; library: Library; converted: number; needsReview: number; issues: Issue[] }
  | { ok: false; issues: Issue[] };

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFoxReplaceFile(input: unknown): boolean {
  return isObject(input) && Array.isArray(input.groups) && typeof input.version === 'string' && !('format' in input);
}

/** FoxReplace stored `\n`, `\r`, `\t` and `\\` as backslash escapes in plain text fields. */
function unescapeFoxReplace(text: string): string {
  return text.replace(/\\[\\nrt]/g, (s) => ({ '\\\\': '\\', '\\n': '\n', '\\r': '\r', '\\t': '\t' })[s] ?? s);
}

const HOST_LIKE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:\/[^*|]*)?$/i;

/**
 * FoxReplace URL entries match anywhere in the URL, use `*` as a wildcard and `|` to anchor either end.
 * Host-like entries become site patterns; everything else becomes a URL-form glob with the same meaning.
 */
function convertUrlPattern(entry: string): { pattern: string; sitesChanged: boolean } | null {
  let body = entry;
  const anchoredStart = body.startsWith('|');
  if (anchoredStart) body = body.slice(1);
  const anchoredEnd = body.endsWith('|');
  if (anchoredEnd) body = body.slice(0, -1);
  body = body.replace(/\*+/g, '*');
  if (body === '' || /\s/.test(body)) return null;

  if (!anchoredStart && !anchoredEnd && HOST_LIKE.test(body)) {
    return { pattern: body, sitesChanged: true };
  }
  if (anchoredStart && !body.includes('://')) return null;

  const glob = (anchoredStart ? '' : '*') + body + (anchoredEnd ? '' : '*');
  return { pattern: glob.replace(/\*+/g, '*'), sitesChanged: false };
}

export function importFoxReplace(input: unknown): FoxReplaceResult {
  if (!isObject(input) || !Array.isArray(input.groups)) {
    return { ok: false, issues: [{ path: '', message: 'This is not a FoxReplace export file.', severity: 'error' }] };
  }
  const version = String(input.version);
  if (!SUPPORTED_VERSIONS.includes(version)) {
    return {
      ok: false,
      issues: [{ path: 'version', message: `FoxReplace file version ${version} is not supported.`, severity: 'error' }],
    };
  }

  const issues: Issue[] = [];
  const groups: Group[] = [];
  const rules: Rule[] = [];
  let needsReview = 0;

  input.groups.forEach((rawGroup, g) => {
    const gPath = `groups[${g}]`;
    if (!isObject(rawGroup) || !Array.isArray(rawGroup.substitutions)) {
      issues.push({ path: gPath, message: 'Group is malformed; skipped.', severity: 'error' });
      return;
    }

    const urls = Array.isArray(rawGroup.urls) ? rawGroup.urls.filter((u): u is string => typeof u === 'string') : [];
    const include: string[] = [];
    const exclude: string[] = [];
    let sitesChanged = false;
    let sitesUnconverted = false;
    for (const url of urls) {
      const isExclusion = url.startsWith('-');
      const converted = convertUrlPattern(isExclusion ? url.slice(1) : url);
      if (!converted) {
        sitesUnconverted = true;
        issues.push({ path: `${gPath}.urls`, message: `Could not convert URL pattern "${url}".`, severity: 'warning' });
        continue;
      }
      sitesChanged ||= converted.sitesChanged;
      (isExclusion ? exclude : include).push(converted.pattern);
    }
    if (sitesChanged) {
      issues.push({
        path: `${gPath}.urls`,
        message: 'Host names now match that site and its subdomains, rather than any URL containing the text.',
        severity: 'warning',
      });
    }

    const name =
      typeof rawGroup.name === 'string' && rawGroup.name !== ''
        ? rawGroup.name
        : urls.length > 0
          ? `Rules for ${urls[0]}`
          : 'General rules';
    const group: Group = { id: newId(), name, enabled: rawGroup.enabled !== false };
    groups.push(group);

    const htmlMode = version === '0.14' ? (rawGroup.html ? 'inputoutput' : 'none') : String(rawGroup.html ?? 'none');
    const manualOnly = rawGroup.mode === 'manual';

    rawGroup.substitutions.forEach((sub, s) => {
      const sPath = `${gPath}.substitutions[${s}]`;
      if (!isObject(sub) || typeof sub.input !== 'string' || sub.input === '') {
        issues.push({ path: `${sPath}.input`, message: 'Find text is missing; skipped.', severity: 'error' });
        return;
      }
      const match = MATCH_BY_INPUT_TYPE[String(sub.inputType)] ?? 'text';
      const output = typeof sub.output === 'string' ? sub.output : '';
      const isFunction = sub.outputType === 'function';

      const rule: Rule = {
        id: newId(),
        groupId: group.id,
        enabled: true,
        find: match === 'regex' ? sub.input : unescapeFoxReplace(sub.input),
        replace: isFunction ? '' : unescapeFoxReplace(output),
        match,
        caseSensitive: sub.caseSensitive === true,
        sites: { include: [...include], exclude: [...exclude] },
        review: null,
      };

      if (isFunction) {
        rule.review = 'function-output';
        rule.legacy = { outputType: 'function', output };
        issues.push({
          path: `${sPath}.output`,
          message: 'JavaScript function output is not supported; rule disabled.',
          severity: 'warning',
        });
      } else if (htmlMode !== 'none') {
        rule.review = 'html-mode';
        rule.legacy = { html: htmlMode };
        issues.push({
          path: `${sPath}`,
          message: `HTML mode ("${htmlMode}") is not supported; rule disabled.`,
          severity: 'warning',
        });
      } else if (sitesUnconverted) {
        rule.review = 'site-pattern';
      } else if (!compilePattern(rule).ok) {
        rule.review = 'invalid-pattern';
        issues.push({ path: `${sPath}.input`, message: 'Pattern is not valid; rule disabled.', severity: 'warning' });
      } else if (manualOnly) {
        rule.review = 'manual-only';
        rule.legacy = { previousMode: 'manual-only' };
        issues.push({
          path: `${gPath}.mode`,
          message: 'Manual-only rules are not supported; review this rule before enabling it automatically.',
          severity: 'warning',
        });
      }

      if (match !== 'regex' && /\$[$&`'<\d]/.test(rule.replace)) {
        issues.push({
          path: `${sPath}.output`,
          message:
            'Replace text contains "$" references, which only work in regex rules; they are now inserted literally.',
          severity: 'warning',
        });
      }

      if (rule.review) {
        rule.enabled = false;
        needsReview++;
      }
      rules.push(rule);
    });
  });

  return {
    ok: true,
    library: { format: 'wordshift', schemaVersion: SCHEMA_VERSION, groups, rules },
    converted: rules.length - needsReview,
    needsReview,
    issues,
  };
}
