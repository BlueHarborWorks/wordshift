# Wordshift

Find and replace text in one tab or automatically across sites, with rules you control.

- **Quick Replace** from the toolbar: live match count, highlights, step through matches, and tab-scoped changes that survive reloads until you remove them.
- **Rules** that run automatically on the sites you choose, including content that loads later.
- **Safe by design**: Wordshift only changes visible text. It does not run code from rules, rewrite HTML or scripts, or touch what you type in forms. Page structure, listeners, and app state are left alone, and every change can be undone.
- **Minimal permissions**: no site access at install. Quick Replace uses the current tab after you open it; automatic rules ask for access to just the sites they use.
- **Local backups**: export your rules as JSON and import them on another Firefox profile or device.

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
| `npm test`                        | Unit tests (engine, site patterns, schema, Wordshift import, DOM)                |
| `npm run e2e`                     | Builds a test variant and runs Playwright against the real extension in Chromium |
| `npm run check`                   | Type check (TypeScript and Svelte)                                               |
| `npm run lint`                    | ESLint                                                                           |
| `npm run lint:ext`                | Builds for Firefox and runs `web-ext lint`                                       |
| `npm run build` / `build:firefox` | Production builds in `.output/`                                                  |
| `npm run zip` / `zip:firefox`     | Store packages                                                                   |

## AMO reviewer build instructions

The submitted Firefox package contains bundled Svelte and TypeScript output, so the matching
source archive is provided for review. The build uses only open-source packages downloaded from
the npm registry; it has no external services or OS-specific build dependencies.

Validated build environments:

- Node.js 24.14.0 with npm 11.9.0 (the AMO default reviewer toolchain)
- Node.js 26.4.0 with npm 11.17.0 on macOS 15.7.3 (arm64)

From the root of the extracted source archive, run:

```sh
npm ci
npm run zip:firefox
```

The command creates:

- `.output/wordshift-0.1.1-firefox.zip` — the Firefox extension package
- `.output/wordshift-0.1.1-sources.zip` — the reviewer source archive

The unpacked Firefox build is also available at `.output/firefox-mv3/`. No environment variables,
credentials, network services, or generated files outside `.output/` are required. `package-lock.json`
pins the dependency tree used for the reproducible build.

## Layout

```
src/core/        Pure logic: matching, site patterns, schema, and validation. No browser APIs.
src/dom/         Page text walking, replacement with undo log, mutation watching.
src/shared/      Storage, messaging, rule selection shared by extension contexts.
src/ui/          Theme tokens and shared Svelte components.
src/entrypoints/ background, content script, popup (Quick Replace), options (Rule Library).
test/            Vitest unit tests and fixtures.
e2e/             Playwright tests.
```

## License

MIT.
