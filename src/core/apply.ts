import type { CompiledPattern } from './compile';

export interface TextMatch {
  start: number;
  end: number;
  replacement: string;
}

/** Non-empty matches of `pattern` in `text`. Empty matches (from lookarounds, `a*`, ...) are skipped. */
export function findMatches(text: string, pattern: CompiledPattern): TextMatch[] {
  const { regex } = pattern;
  const matches: TextMatch[] = [];
  regex.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m[0] === '') {
      // Step past the empty match by one code point so the scan always advances.
      const code = text.codePointAt(regex.lastIndex);
      regex.lastIndex += code !== undefined && code > 0xffff ? 2 : 1;
      continue;
    }
    matches.push({ start: m.index, end: m.index + m[0].length, replacement: pattern.replacement(m, text) });
  }
  return matches;
}

/** Applies matches produced by `findMatches` on the same text. */
export function spliceMatches(text: string, matches: readonly TextMatch[]): string {
  let out = '';
  let cursor = 0;
  for (const match of matches) {
    out += text.slice(cursor, match.start) + match.replacement;
    cursor = match.end;
  }
  return out + text.slice(cursor);
}

/** Runs each pattern in order over the text, feeding each one the previous result. */
export function applyPatterns(text: string, patterns: readonly CompiledPattern[]): { text: string; counts: number[] } {
  const counts: number[] = [];
  for (const pattern of patterns) {
    const matches = findMatches(text, pattern);
    counts.push(matches.length);
    if (matches.length > 0) text = spliceMatches(text, matches);
  }
  return { text, counts };
}
