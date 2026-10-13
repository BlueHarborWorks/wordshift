import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifestVersion: 3,
  outDir: process.env.WORDSHIFT_E2E ? '.output-e2e' : '.output',
  manifest: ({ browser }) => ({
    name: 'Wordshift',
    description: 'Find and replace text in one tab or automatically across sites, with rules you control.',
    homepage_url: 'https://github.com/BlueHarborWorks/wordshift',
    // activeTab covers Quick Replace on the current tab. Sites for automatic rules are requested
    // at runtime, only when the user turns them on.
    permissions: ['storage', 'activeTab', 'scripting'],
    optional_host_permissions: ['<all_urls>'],
    // End-to-end tests cannot click permission prompts, so test builds get site access up front.
    ...(process.env.WORDSHIFT_E2E && { host_permissions: ['<all_urls>'] }),
    action: { default_title: 'Wordshift' },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+F' },
        description: 'Open Quick Replace',
      },
    },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'wordshift@blueharborworks',
          strict_min_version: '142.0',
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
