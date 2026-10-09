import { describe, expect, it } from 'vitest';
import { ALL_URLS, inScope, matchesSitePattern, permissionOrigins, sitePatternError } from '../src/core/sites';

describe('site form', () => {
  it('matches the host and its subdomains', () => {
    expect(matchesSitePattern('https://example.com/', 'example.com')).toBe(true);
    expect(matchesSitePattern('https://www.example.com/a', 'example.com')).toBe(true);
    expect(matchesSitePattern('https://notexample.com/', 'example.com')).toBe(false);
  });

  it('does not match the text elsewhere in the URL', () => {
    expect(matchesSitePattern('https://other.test/?ref=example.com', 'example.com')).toBe(false);
  });

  it('limits by path prefix', () => {
    expect(matchesSitePattern('https://example.com/docs/intro', 'example.com/docs')).toBe(true);
    expect(matchesSitePattern('https://example.com/blog', 'example.com/docs')).toBe(false);
  });

  it('supports * inside the host and ports', () => {
    expect(matchesSitePattern('https://example.co.uk/', 'example.*')).toBe(true);
    expect(matchesSitePattern('http://localhost:8080/', 'localhost:8080')).toBe(true);
    expect(matchesSitePattern('http://localhost:3000/', 'localhost:8080')).toBe(false);
  });
});

describe('URL form', () => {
  it('matches the start of the URL with * wildcards', () => {
    expect(matchesSitePattern('https://example.com/a/b', 'https://example.com/*')).toBe(true);
    expect(matchesSitePattern('http://example.com/a', 'https://example.com/*')).toBe(false);
    expect(matchesSitePattern('https://x.test/search?q=cats', '*q=cats*')).toBe(true);
    expect(matchesSitePattern('https://x.test/search?q=cats&page=2', '*q=cats')).toBe(true);
    // A pasted address without a trailing slash still covers the site.
    expect(matchesSitePattern('https://example.com/', 'https://example.com')).toBe(true);
    expect(matchesSitePattern('https://example.community/', 'https://example.com')).toBe(true);
  });
});

describe('scopes', () => {
  it('treats an empty include list as every site, and lets exclusions win', () => {
    expect(inScope('https://a.test/', { include: [], exclude: [] })).toBe(true);
    expect(inScope('https://a.test/admin', { include: ['a.test'], exclude: ['a.test/admin'] })).toBe(false);
  });

  it('validates patterns', () => {
    expect(sitePatternError('')).not.toBeNull();
    expect(sitePatternError('has space.com')).not.toBeNull();
    expect(sitePatternError('example.com')).toBeNull();
  });

  it('derives the narrowest host permissions', () => {
    expect(permissionOrigins({ include: [], exclude: [] })).toEqual([ALL_URLS]);
    expect(permissionOrigins({ include: ['example.com/docs'], exclude: [] })).toEqual([
      '*://example.com/*',
      '*://*.example.com/*',
    ]);
    expect(permissionOrigins({ include: ['https://example.com/a*'], exclude: [] })).toEqual(['https://example.com/*']);
    expect(permissionOrigins({ include: ['https://example.com'], exclude: [] })).toEqual(['https://example.com/*']);
    expect(permissionOrigins({ include: ['example.*'], exclude: [] })).toEqual([ALL_URLS]);
  });
});
