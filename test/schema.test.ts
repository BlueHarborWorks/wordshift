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
    review: null,
    ...overrides,
  };
}

function library(rules: unknown[], groups: unknown[] = []): unknown {
  return { format: 'wordshift', schemaVersion: 2, groups, rules };
}

describe('parseLibrary', () => {
  it('round-trips a valid library unchanged', () => {
    const input: Library = {
      format: 'wordshift',
      schemaVersion: 2,
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

  it('migrates manual-only schema 1 rules into disabled review items', () => {
    const legacy = {
      format: 'wordshift',
      schemaVersion: 1,
      groups: [],
      rules: [{ ...rule(), apply: { auto: false, manual: true } }],
    };
    const result = parseLibrary(legacy);
    if (!result.ok) throw new Error('expected ok');
    expect(result.library.schemaVersion).toBe(2);
    expect(result.library.rules[0]).toMatchObject({
      enabled: false,
      review: 'manual-only',
      legacy: { previousMode: 'manual-only' },
    });
    expect(result.library.rules[0]).not.toHaveProperty('apply');
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
    expect(result.converted).toBe(3);
    expect(result.needsReview).toBe(3);

    const [colour, degrees, linebreak, fn, bar, markup] = rules;
    expect(colour).toMatchObject({ find: 'colour', replace: 'color', match: 'word', enabled: true });
    expect(degrees).toMatchObject({ find: '(\\d+)F', replace: '$1 degrees', match: 'regex', caseSensitive: true });
    expect(linebreak).toMatchObject({ find: 'line\nbreak', replace: 'a\\b' });

    expect(fn).toMatchObject({ enabled: false, review: 'function-output', legacy: { output: 'match.toUpperCase()' } });
    expect(bar).toMatchObject({
      enabled: false,
      review: 'manual-only',
      sites: { include: ['example.com', 'https://docs.test/*', '*search?q=*'], exclude: ['example.com/admin'] },
    });
    expect(markup).toMatchObject({ enabled: false, review: 'html-mode' });

    // The converted library is itself valid.
    expect(parseLibrary(JSON.parse(JSON.stringify(result.library))).ok).toBe(true);
  });

  it('converts a 0.14 file and flags invalid patterns', () => {
    const result = importFoxReplace(fixture('foxreplace-0.14.json'));
    if (!result.ok) throw new Error('expected ok');
    const [teh, broken] = result.library.rules;
    expect(teh).toMatchObject({ match: 'word', enabled: true });
    expect(broken).toMatchObject({ enabled: false, review: 'invalid-pattern' });
  });

  it('converts a 0.15 file (string html mode, no mode field, no outputType)', () => {
    const result = importFoxReplace(fixture('foxreplace-0.15.json'));
    if (!result.ok) throw new Error('expected ok');
    const [recieve, seperate, bold] = result.library.rules;
    expect(recieve).toMatchObject({
      find: 'recieve',
      replace: 'receive',
      match: 'text',
      enabled: true,
      sites: { include: ['http://forum.example.net/*'], exclude: [] },
    });
    expect(seperate).toMatchObject({ match: 'word', caseSensitive: true });
    expect(bold).toMatchObject({ enabled: false, review: 'html-mode', legacy: { html: 'inputoutput' } });
    expect(result.library.groups[1]!.name).toBe('General rules');
    expect(parseLibrary(JSON.parse(JSON.stringify(result.library))).ok).toBe(true);
  });

  it('converts a 2.1 file (mode field, exclusions, disabled group)', () => {
    const result = importFoxReplace(fixture('foxreplace-2.1.json'));
    if (!result.ok) throw new Error('expected ok');
    const [utilise, email, date] = result.library.rules;
    expect(utilise).toMatchObject({
      enabled: false,
      review: 'manual-only',
      sites: { include: ['docs.example.org'], exclude: ['docs.example.org/legacy'] },
    });
    expect(email).toMatchObject({ find: 'e-mail', match: 'text' });
    expect(date).toMatchObject({ find: '\\d{4}-\\d{2}-\\d{2}', match: 'regex' });
    expect(result.library.groups.map((g) => g.enabled)).toEqual([true, false]);
    expect(result.needsReview).toBe(2);
  });

  it('rejects unknown versions', () => {
    expect(importFoxReplace({ version: '9.0', groups: [] }).ok).toBe(false);
  });
});
