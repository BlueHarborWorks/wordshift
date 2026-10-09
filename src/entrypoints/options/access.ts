import { ALL_URLS, permissionOrigins } from '../../core/sites';
import type { Rule } from '../../core/types';

/** A readable name for a host-permission match pattern. */
export function describeOrigin(origin: string): string {
  if (origin === ALL_URLS || origin === '*://*/*') return 'all sites';
  const m = /^([^:]+):\/\/(\*\.)?([^/]+)\//.exec(origin);
  if (!m) return origin;
  return m[2] ? `subdomains of ${m[3]}` : m[3]!;
}

/** True when an automatic rule could run everywhere it is scoped to. */
export function hasAccess(rule: Rule, granted: readonly string[]): boolean {
  if (granted.includes(ALL_URLS) || granted.includes('*://*/*')) return true;
  return permissionOrigins(rule.sites).every((o) => granted.includes(o));
}
