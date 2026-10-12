# Wordshift

Find and replace text on web pages, once or automatically, with rules you control.

- **Quick Replace** from the toolbar: live match count, highlights, step through matches, replace one or all, undo.
- **Rules** that run automatically on the sites you choose, including content that loads later.
- **Safe by design**: Wordshift only changes visible text. It does not run code from rules, rewrite HTML or scripts, or touch what you type in forms. Page structure, listeners, and app state are left alone, and every change can be undone.
- **Minimal permissions**: no site access at install. Quick Replace uses the current tab only when you open it; automatic rules ask for access to just the sites they use.
- **Import from FoxReplace**: export your FoxReplace list and import it. Rules that used JavaScript functions or HTML mode are kept but turned off for review.

Built for Firefox (142+) and Chromium browsers, Manifest V3.

Landing page: https://blueharborworks.github.io/wordshift/ (source in `site/`, deployed by the Landing page workflow).

## Development

```sh
npm install
npm run dev            # Chromium with live reload
npm run dev:firefox    # Firefox with live reload
```

| Command                           | What it does                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `npm test`                        | Unit tests (engine, site patterns, schema, FoxReplace import, DOM)               |
| `npm run e2e`                     | Builds a test variant and runs Playwright against the real extension in Chromium |
| `npm run check`                   | Type check (TypeScript and Svelte)                                               |
| `npm run lint`                    | ESLint                                                                           |
| `npm run lint:ext`                | Builds for Firefox and runs `web-ext lint`                                       |
| `npm run build` / `build:firefox` | Production builds in `.output/`                                                  |
| `npm run zip` / `zip:firefox`     | Store packages                                                                   |

## Layout

```
src/core/        Pure logic: matching, site patterns, schema, FoxReplace import. No browser APIs.
src/dom/         Page text walking, replacement with undo log, mutation watching.
src/shared/      Storage, messaging, rule selection shared by extension contexts.
src/ui/          Theme tokens and shared Svelte components.
src/entrypoints/ background, content script, popup (Quick Replace), options (Rule Library).
test/            Vitest unit tests and fixtures.
e2e/             Playwright tests.
docs/            Audit of FoxReplace and the Wordshift roadmap.
```

## License

MIT. Wordshift is an independent implementation; it shares no code with FoxReplace.
