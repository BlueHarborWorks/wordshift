import type { SiteScope } from './types';

/*
 * Site patterns come in two forms:
 *
 *   Site form   example.com            example.com and all of its subdomains
 *               example.com/docs       ...only where the path starts with /docs
 *               example.*              `*` matches anything within the host
 *
 *   URL form    https://example.com/*  the URL must start with this; `*` matches anything
 *               *://*.example.com/a*   (used when the pattern has "://" or starts with "*")
 */

function escapeRegex(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
}

function globSource(glob: string): string {
  return glob.split('*').map(escapeRegex).join('.*');
}

function isUrlForm(pattern: string): boolean {
  return pattern.startsWith('*') || pattern.includes('://');
}

export function sitePatternError(pattern: string): string | null {
  if (pattern.trim() === '') return 'Site pattern is empty.';
  if (/\s/.test(pattern)) return 'Site patterns cannot contain spaces.';
  if (!isUrlForm(pattern)) {
    const host = pattern.split('/')[0] ?? '';
    if (host === '' || host.startsWith('.')) return 'Start with a host name, such as example.com.';
  }
  return null;
}

export function matchesSitePattern(url: string, pattern: string): boolean {
  if (sitePatternError(pattern) !== null) return false;

  if (isUrlForm(pattern)) {
    // A prefix match, so `https://example.com` also covers `https://example.com/` and deeper paths.
    return new RegExp(`^${globSource(pattern)}`, 'i').test(url);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const slash = pattern.indexOf('/');
  const hostPattern = (slash === -1 ? pattern : pattern.slice(0, slash)).toLowerCase();
  const pathPattern = slash === -1 ? '' : pattern.slice(slash);

  const host = hostPattern.includes(':') ? parsed.host : parsed.hostname;
  const hostSource = globSource(hostPattern);
  if (!new RegExp(`^(?:.+\\.)?${hostSource}$`, 'i').test(host)) return false;

  if (pathPattern === '') return true;
  return new RegExp(`^${globSource(pathPattern)}`).test(parsed.pathname + parsed.search);
}

export function inScope(url: string, scope: SiteScope): boolean {
  const included = scope.include.length === 0 || scope.include.some((p) => matchesSitePattern(url, p));
  return included && !scope.exclude.some((p) => matchesSitePattern(url, p));
}

export const ALL_URLS = '<all_urls>';

/**
 * Browser host-permission match patterns that cover a scope's include list.
 * Falls back to ALL_URLS when a pattern cannot be expressed more narrowly.
 */
export function permissionOrigins(scope: SiteScope): string[] {
  if (scope.include.length === 0) return [ALL_URLS];

  const origins = new Set<string>();
  for (const pattern of scope.include) {
    if (sitePatternError(pattern) !== null) continue;

    if (isUrlForm(pattern)) {
      const m = /^(\*|https?):\/\/([^/*]+|\*\.[^/*]+)(?:\/|$)/.exec(pattern);
      if (!m) return [ALL_URLS];
      origins.add(`${m[1]}://${m[2]}/*`);
      continue;
    }

    const host = (pattern.split('/')[0] ?? '').replace(/:\d+$/, '').toLowerCase();
    if (host.includes('*')) return [ALL_URLS];
    origins.add(`*://${host}/*`);
    origins.add(`*://*.${host}/*`);
  }
  return [...origins];
}
