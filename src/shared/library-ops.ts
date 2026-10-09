import { newId } from '../core/schema';
import type { Library, MatchMode, Rule, SiteScope } from '../core/types';

export function createRule(fields: {
  find: string;
  replace: string;
  match: MatchMode;
  caseSensitive: boolean;
  sites?: SiteScope;
  groupId?: string | null;
}): Rule {
  return {
    id: newId(),
    groupId: fields.groupId ?? null,
    enabled: true,
    find: fields.find,
    replace: fields.replace,
    match: fields.match,
    caseSensitive: fields.caseSensitive,
    sites: fields.sites ?? { include: [], exclude: [] },
    apply: { auto: true, manual: true },
    review: null,
  };
}

/** Appends `incoming` to `library`, keeping ids unique. */
export function mergeLibraries(library: Library, incoming: Library): Library {
  const groupIds = new Map<string, string>();
  const takenGroups = new Set(library.groups.map((g) => g.id));
  const groups = incoming.groups.map((g) => {
    const id = takenGroups.has(g.id) ? newId() : g.id;
    groupIds.set(g.id, id);
    return { ...g, id };
  });
  const takenRules = new Set(library.rules.map((r) => r.id));
  const rules = incoming.rules.map((r) => ({
    ...r,
    id: takenRules.has(r.id) ? newId() : r.id,
    groupId: r.groupId === null ? null : (groupIds.get(r.groupId) ?? null),
  }));
  return { ...library, groups: [...library.groups, ...groups], rules: [...library.rules, ...rules] };
}
