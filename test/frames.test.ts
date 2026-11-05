import { describe, expect, it } from 'vitest';
import type { PageStatus, QuickAction } from '../src/shared/messages';
import { combineStatus, locateMatch } from '../src/shared/tabs';

describe('locateMatch', () => {
  it('maps a match index across frames in order', () => {
    expect(locateMatch([1, 3], 0)).toEqual({ frame: 0, local: 0 });
    expect(locateMatch([1, 3], 1)).toEqual({ frame: 1, local: 0 });
    expect(locateMatch([1, 3], 3)).toEqual({ frame: 1, local: 2 });
  });

  it('skips frames without matches', () => {
    expect(locateMatch([0, 0, 2], 1)).toEqual({ frame: 2, local: 1 });
  });

  it('returns null outside the matches', () => {
    expect(locateMatch([1, 3], 4)).toBeNull();
    expect(locateMatch([1, 3], -1)).toBeNull();
    expect(locateMatch([], 0)).toBeNull();
  });
});

const action = (id: number, at?: number): QuickAction => ({
  id,
  find: 'cli',
  replace: 'route',
  replacements: 1,
  match: 'text',
  caseSensitive: false,
  mode: 'all',
  at,
});

const status = (fields: Partial<PageStatus>): PageStatus => ({
  autoRules: 0,
  autoReplacements: 0,
  canUndo: false,
  paused: false,
  quickActions: [],
  ...fields,
});

describe('combineStatus', () => {
  it('counts each automatic rule once and adds up replacements', () => {
    const combined = combineStatus([
      { frameId: 0, status: status({ autoRules: 1, autoRuleIds: ['a'], autoReplacements: 1 }) },
      { frameId: 7, status: status({ autoRules: 2, autoRuleIds: ['a', 'b'], autoReplacements: 5 }) },
    ]);
    expect(combined.autoRules).toBe(2);
    expect(combined.autoReplacements).toBe(6);
  });

  it('lists Quick actions oldest first with their frame, and takes pause state from the top frame', () => {
    const combined = combineStatus([
      { frameId: 0, status: status({ paused: true, quickActions: [action(1, 300)] }) },
      { frameId: 7, status: status({ canUndo: true, quickActions: [action(1, 100), action(2, 500)] }) },
    ]);
    expect(combined.quickActions.map((a) => [a.frameId, a.at])).toEqual([
      [7, 100],
      [0, 300],
      [7, 500],
    ]);
    expect(combined.canUndo).toBe(true);
    expect(combined.paused).toBe(true);
  });

  it('keeps frame order for actions saved before timestamps existed', () => {
    const combined = combineStatus([
      { frameId: 0, status: status({ quickActions: [action(1), action(2)] }) },
      { frameId: 3, status: status({ quickActions: [action(1)] }) },
    ]);
    expect(combined.quickActions.map((a) => [a.frameId, a.id])).toEqual([
      [0, 1],
      [0, 2],
      [3, 1],
    ]);
  });
});
