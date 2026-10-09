import type { MatchMode } from './types';

/** The parts of a rule that decide what is matched and what it becomes. */
export interface PatternSpec {
  find: string;
  replace: string;
  match: MatchMode;
  caseSensitive: boolean;
}

export interface CompiledPattern {
  /** Always has the `g` flag. Shared state: callers must reset `lastIndex`. */
  regex: RegExp;
  /** Replacement text for one match of `regex` in `input`. */
  replacement(match: RegExpExecArray, input: string): string;
}

export type CompileResult = { ok: true; pattern: CompiledPattern; warnings: string[] } | { ok: false; error: string };

const WORD_CHAR = /[\p{L}\p{M}\p{N}_]/u;
const WORD_CHAR_CLASS = '[\\p{L}\\p{M}\\p{N}_]';

/** Characters that need escaping in a `u`-flag regex. Escaping anything else is a syntax error there. */
function escapeRegex(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
}

/** Escapes text and lets each run of whitespace match any run of whitespace, as the page renders it. */
function literalSource(text: string): string {
  return text
    .split(/(\s+)/u)
    .map((part, i) => (i % 2 === 1 ? '\\s+' : escapeRegex(part)))
    .join('');
}

// Rough check for nested quantifiers such as (a+)+ or (\w*)*, the usual cause of catastrophic backtracking.
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/;

export function compilePattern(spec: PatternSpec): CompileResult {
  if (spec.find === '') return { ok: false, error: 'Find text is empty.' };

  const flags = spec.caseSensitive ? 'gu' : 'giu';
  const warnings: string[] = [];
  let source: string;

  switch (spec.match) {
    case 'text':
      source = literalSource(spec.find);
      break;
    case 'word': {
      const first = spec.find.charAt(0);
      const last = spec.find.charAt(spec.find.length - 1);
      const before = WORD_CHAR.test(first) ? `(?<!${WORD_CHAR_CLASS})` : '';
      const after = WORD_CHAR.test(last) ? `(?!${WORD_CHAR_CLASS})` : '';
      source = before + literalSource(spec.find) + after;
      break;
    }
    case 'regex':
      source = spec.find;
      if (NESTED_QUANTIFIER.test(source)) {
        warnings.push('Nested repetition such as (a+)+ can make pages slow. Consider simplifying the pattern.');
      }
      break;
  }

  let regex: RegExp;
  try {
    regex = new RegExp(source, flags);
  } catch (error) {
    // Unicode mode rejects some escapes that older patterns rely on, such as `\-` or a lone `{`.
    // Fall back to the classic mode so those rules keep working; it only loses astral-character handling.
    try {
      if (spec.match !== 'regex') throw error;
      regex = new RegExp(source, flags.replace('u', ''));
    } catch {
      return { ok: false, error: describeRegexError(error) };
    }
  }

  const replacement =
    spec.match === 'regex'
      ? (match: RegExpExecArray, input: string) => expandTemplate(spec.replace, match, input)
      : () => spec.replace;

  return { ok: true, pattern: { regex, replacement }, warnings };
}

function describeRegexError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Engines prefix messages with "Invalid regular expression: /source/flags: "; keep only the reason.
  return message.replace(/^Invalid regular expression: \/.*\/[a-z]*: /s, '');
}

/**
 * Expands `$` references in a regex replacement, following String.prototype.replace:
 * `$$`, `$&`, `` $` ``, `$'`, `$1`..`$99`, and `$<name>`.
 */
export function expandTemplate(template: string, match: RegExpExecArray, input: string): string {
  if (!template.includes('$')) return template;

  const groupCount = match.length - 1;
  return template.replace(/\$(\$|&|`|'|\d{1,2}|<([^>]*)>)/g, (token, ref: string, name?: string) => {
    if (ref === '$') return '$';
    if (ref === '&') return match[0];
    if (ref === '`') return input.slice(0, match.index);
    if (ref === "'") return input.slice(match.index + match[0].length);
    if (name !== undefined) {
      if (!match.groups) return token;
      return match.groups[name] ?? '';
    }
    // Two digits only if that group exists, otherwise one digit followed by a literal digit.
    const two = Number(ref);
    if (ref.length === 2 && two >= 1 && two <= groupCount) return match[two] ?? '';
    const one = Number(ref.charAt(0));
    if (one >= 1 && one <= groupCount) return (match[one] ?? '') + ref.slice(1);
    return token;
  });
}
