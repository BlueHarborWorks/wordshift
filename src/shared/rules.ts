import { compilePattern } from '../core/compile';
import { inScope, permissionOrigins, ALL_URLS } from '../core/sites';
import type { Library, Rule, Settings } from '../core/types';
import type { ActiveRule } from '../dom/replacer';

/** Rules that are switched on, in an enabled group (or none), and not waiting for review. */
export function liveRules(library: Library): Rule[] {
  const disabledGroups = new Set(library.groups.filter((g) => !g.enabled).map((g) => g.id));
  return library.rules.filter(
    (r) => r.enabled && r.review === null && (r.groupId === null || !disabledGroups.has(r.groupId)),
  );
}

/** Compiled rules of one kind that apply to `url`, in library order. */
export function rulesFor(library: Library, url: string, kind: 'auto' | 'manual'): ActiveRule[] {
  const out: ActiveRule[] = [];
  for (const rule of liveRules(library)) {
    if (!rule.apply[kind] || !inScope(url, rule.sites)) continue;
    const compiled = compilePattern(rule);
    if (compiled.ok) out.push({ id: rule.id, pattern: compiled.pattern });
  }
  return out;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function isPaused(settings: Settings, url: string): boolean {
  const host = hostOf(url);
  return host !== '' && settings.pausedSites.includes(host);
}

/** Host permissions that automatic rules need, collapsed to <all_urls> when any rule needs it. */
export function requiredOrigins(library: Library): string[] {
  const origins = new Set<string>();
  for (const rule of liveRules(library)) {
    if (!rule.apply.auto) continue;
    for (const origin of permissionOrigins(rule.sites)) origins.add(origin);
  }
  return origins.has(ALL_URLS) ? [ALL_URLS] : [...origins];
}
