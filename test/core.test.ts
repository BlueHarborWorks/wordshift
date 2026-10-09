import { describe, expect, it } from 'vitest';
import { applyPatterns, findMatches } from '../src/core/apply';
import { compilePattern, type PatternSpec } from '../src/core/compile';

function compile(spec: Partial<PatternSpec> & { find: string }) {
  const result = compilePattern({ replace: '', match: 'text', caseSensitive: false, ...spec });
  if (!result.ok) throw new Error(result.error);
  return result.pattern;
}

function run(text: string, spec: Partial<PatternSpec> & { find: string }) {
  return applyPatterns(text, [compile(spec)]).text;
}

describe('text match', () => {
  it('is case-insensitive by default and literal', () => {
    expect(run('Colour, colour, COLOUR', { find: 'colour', replace: 'color' })).toBe('color, color, color');
    expect(run('a.b axb', { find: 'a.b', replace: 'X' })).toBe('X axb');
    expect(run('cost $5 (approx)', { find: '$5 (approx)', replace: 'five' })).toBe('cost five');
  });

  it('respects case sensitivity', () => {
    expect(run('Apple apple', { find: 'apple', replace: 'pear', caseSensitive: true })).toBe('Apple pear');
  });

  it('folds Unicode case', () => {
    expect(run('ÉCOLE école', { find: 'école', replace: 'school' })).toBe('school school');
  });

  it('matches any run of whitespace where the find text has whitespace', () => {
    expect(run('New\n  York and New York', { find: 'New York', replace: 'NYC' })).toBe('NYC and NYC');
  });

  it('inserts replacement text literally, including $ sequences', () => {
    expect(run('price', { find: 'price', replace: '$& costs $$1' })).toBe('$& costs $$1');
  });
});

describe('word match', () => {
  const spec = { match: 'word' as const, replace: 'X' };

  it('matches whole words only', () => {
    expect(run('cat concat cats cat.', { ...spec, find: 'cat' })).toBe('X concat cats X.');
  });

  it('treats accented letters and digits as word characters', () => {
    expect(run('café cafés', { ...spec, find: 'café' })).toBe('X cafés');
    expect(run('v2 v20', { ...spec, find: 'v2' })).toBe('X v20');
  });

  it('applies no boundary on edges that are punctuation', () => {
    expect(run('a-(b)-c', { ...spec, find: '(b)' })).toBe('a-X-c');
  });
});

describe('regex match', () => {
  const spec = { match: 'regex' as const };

  it('expands $ references like String.prototype.replace', () => {
    expect(run('John Smith', { ...spec, find: '(\\w+) (\\w+)', replace: '$2, $1' })).toBe('Smith, John');
    expect(run('2026-10-08', { ...spec, find: '(?<y>\\d+)-(?<m>\\d+)-(?<d>\\d+)', replace: '$<d>/$<m>/$<y>' })).toBe(
      '08/10/2026',
    );
    expect(run('abc', { ...spec, find: 'b', replace: "[$&|$`|$'|$$]" })).toBe('a[b|a|c|$]c');
  });

  it('reads $10 as group 1 followed by "0" when there is no group 10', () => {
    expect(run('ab', { ...spec, find: '(a)(b)', replace: '$10' })).toBe('a0');
  });

  it('leaves unknown references as written', () => {
    expect(run('ab', { ...spec, find: 'a', replace: '$3 $<x>' })).toBe('$3 $<x>b');
  });

  it('skips empty matches instead of inserting text everywhere', () => {
    expect(run('aaa b', { ...spec, find: 'a*', replace: 'X' })).toBe('X b');
    const pattern = compile({ ...spec, find: '(?=x)' });
    expect(findMatches('😀x😀x', pattern)).toEqual([]);
  });

  it('reports syntax errors without the engine prefix', () => {
    const result = compilePattern({ find: '(abc', replace: '', match: 'regex', caseSensitive: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toMatch(/^Invalid regular expression/);
  });

  it('accepts classic-mode escapes that Unicode mode rejects', () => {
    expect(run('a-b', { ...spec, find: 'a\\-b', replace: 'X' })).toBe('X');
    expect(run('x{y', { ...spec, find: 'x{y', replace: 'X' })).toBe('X');
  });

  it('warns about nested repetition', () => {
    const result = compilePattern({ find: '(a+)+$', replace: '', match: 'regex', caseSensitive: false });
    expect(result.ok && result.warnings.length).toBe(1);
  });
});

describe('rules in sequence', () => {
  it('feeds each rule the previous output and counts matches per rule', () => {
    const patterns = [compile({ find: 'a', replace: 'b' }), compile({ find: 'b', replace: 'c' })];
    expect(applyPatterns('ab', patterns)).toEqual({ text: 'cc', counts: [1, 2] });
  });

  it('rejects empty find text', () => {
    expect(compilePattern({ find: '', replace: 'x', match: 'text', caseSensitive: false }).ok).toBe(false);
  });
});
