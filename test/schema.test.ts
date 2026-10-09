import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importFoxReplace, isFoxReplaceFile } from '../src/core/foxreplace';
import { parseLibrary } from '../src/core/schema';
import type { Library, Rule } from '../src/core/types';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'r1',
    groupId: null,
    enabled: true,
    find: 'a',
    replace: 'b',
    match: 'text',
    caseSensitive: false,
    sites: { include: [], exclude: [] },
    apply: { auto: true, manual: true },
    review: null,
    ...overrides,
  };
}

function library(rules: unknown[], groups: unknown[] = []): unknown {
  return { format: 'wordshift', schemaVersion: 1, groups, rules };
}

describe('parseLibrary', () => {
  it('round-trips a valid library unchanged', () => {
    const input: Library = {
      format: 'wordshift',
      schemaVersion: 1,
      groups: [{ id: 'g1', name: 'Spelling', enabled: true }],
      rules: [rule({ groupId: 'g1', legacy: { kept: true } }), rule({ id: 'r2', match: 'regex', find: '(\\d+)' })],
    };
    const result = parseLibrary(JSON.parse(JSON.stringify(input)));
    expect(result).toEqual({ ok: true, library: input, issues: [] });
  });

  it('rejects other files and newer schema versions', () => {
    expect(parseLibrary([]).ok).toBe(false);
    expect(parseLibrary({ format: 'other' }).ok).toBe(false);
    const newer = parseLibrary({ format: 'wordshift', schemaVersion: 99, groups: [], rules: [] });
    expect(newer.ok).toBe(false);
    expect(!newer.ok && newer.issues[0]!.message).toMatch(/newer version/);
  });

  it('drops broken rules with a path and keeps the rest', () => {
    const result = parseLibrary(library([rule(), { id: 'x', find: 'a', replace: 'b', match: 'fuzzy' }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.library.rules).toHaveLength(1);
    expect(result.issues).toEqual([expect.objectContaining({ path: 'rules[1].match', severity: 'error' })]);
  });

  it('disables rules whose pattern no longer compiles', () => {
    const result = parseLibrary(library([rule({ match: 'regex', find: '(' })]));
    expect(result.ok && result.library.rules[0]).toMatchObject({ enabled: false, review: 'invalid-pattern' });
  });

  it('repairs duplicate ids and unknown groups', () => {
    const result = parseLibrary(library([rule(), rule({ groupId: 'missing' })]));
    if (!result.ok) throw new Error('expected ok');
    const [a, b] = result.library.rules;
    expect(a!.id).not.toBe(b!.id);
    expect(b!.groupId).toBeNull();
    expect(result.issues.map((i) => i.path)).toEqual(['rules[1].groupId', 'rules[1].id']);
  });
});

describe('importFoxReplace', () => {
  it('recognises FoxReplace files', () => {
    expect(isFoxReplaceFile(fixture('foxreplace-2.6.json'))).toBe(true);
    expect(isFoxReplaceFile(library([]))).toBe(false);
  });

  it('converts a 2.6 file', () => {
    const result = importFoxReplace(fixture('foxreplace-2.6.json'));
    if (!result.ok) throw new Error('expected ok');
    const { groups, rules } = result.library;

    expect(groups.map((g) => [g.name, g.enabled])).toEqual([
      ['Spelling', true],
      ['Rules for example.com', false],
      ['Markup', true],
    ]);
    expect(result.converted).toBe(4);
    expect(result.needsReview).toBe(2);

    const [colour, degrees, linebreak, fn, bar, markup] = rules;
    expect(colour).toMatchObject({ find: 'colour', replace: 'color', match: 'word', enabled: true });
    expect(degrees).toMatchObject({ find: '(\\d+)F', replace: '$1 degrees', match: 'regex', caseSensitive: true });
    expect(linebreak).toMatchObject({ find: 'line\nbreak', replace: 'a\\b' });

    expect(fn).toMatchObject({ enabled: false, review: 'function-output', legacy: { output: 'match.toUpperCase()' } });
    expect(bar).toMatchObject({
      enabled: true,
      apply: { auto: false, manual: true },
      sites: { include: ['example.com', 'https://docs.test/*', '*search?q=*'], exclude: ['example.com/admin'] },
    });
    expect(markup).toMatchObject({ enabled: false, review: 'html-mode', apply: { auto: true, manual: false } });

    // The converted library is itself valid.
    expect(parseLibrary(JSON.parse(JSON.stringify(result.library))).ok).toBe(true);
  });

  it('converts a 0.14 file and flags invalid patterns', () => {
    const result = importFoxReplace(fixture('foxreplace-0.14.json'));
    if (!result.ok) throw new Error('expected ok');
    const [teh, broken] = result.library.rules;
    expect(teh).toMatchObject({ match: 'word', apply: { auto: true, manual: true }, enabled: true });
    expect(broken).toMatchObject({ enabled: false, review: 'invalid-pattern' });
  });

  it('rejects unknown versions', () => {
    expect(importFoxReplace({ version: '9.0', groups: [] }).ok).toBe(false);
  });
});
