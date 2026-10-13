import { describe, expect, it } from 'vitest';
import { parseLibrary } from '../src/core/schema';
import type { Library, Rule } from '../src/core/types';

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
