import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
  { ignores: ['.output', '.output-e2e', '.wxt', 'node_modules', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
  {
    // WXT auto-imports these in extension entrypoints.
    files: ['src/**'],
    languageOptions: {
      globals: { browser: 'readonly', defineBackground: 'readonly', defineContentScript: 'readonly' },
    },
  },
);
