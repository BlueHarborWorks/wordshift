# Wordshift: Audit and Roadmap

Updated: 2026-10-08
Background: FoxReplace 2.6.3 (upstream commit `fcbd594`) was audited first. Wordshift is a from-scratch rewrite under the MIT license; it shares no code with FoxReplace and reads FoxReplace export files only as a data format.

Sections 1 and 5 cite FoxReplace 2.6.3 file and line numbers, which are kept as the reasons behind Wordshift's design. Items marked **(verify)** are platform assumptions that still need confirming.

## Status

| Phase                            | State                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Foundation                     | Done: WXT + Svelte 5 + TypeScript, ESLint, Prettier, Vitest, Playwright, CI workflow, MV3 manifests for Chromium and Firefox.                                                                                                                                                                   |
| 1 Safe replacement engine        | Done, with one limit noted below.                                                                                                                                                                                                                                                               |
| 2 Storage, schema, import/export | Done. FoxReplace fixtures for every supported format version (0.14, 0.15, 2.1, 2.6) are tested.                                                                                                                                                                                                 |
| 3 UX rebuild                     | Done. Popup with Quick Replace, Rule Library with editor, groups, import, export, settings. axe-core (WCAG 2.2 AA, serious and critical) passes on every screen in both themes; the main flows run by keyboard alone; the Library works at 320 px wide. All of this is in the end-to-end suite. |
| 4 Advanced features              | Not started.                                                                                                                                                                                                                                                                                    |
| 5 Store release                  | Not started. Permission model (activeTab plus optional per-site host access) is already in place.                                                                                                                                                                                               |

## Accessibility pass (2026-10-09)

axe-core found one real problem: the faintest grey text (`--text-faint`) failed the 4.5:1 contrast ratio in both themes. The token was darkened in light mode and lightened in dark mode so every use passes. Keyboard runs of the popup and Library flows needed no changes. The 320 px check found the sidebar filling the first screen and the editor landing below the whole list; on narrow screens the navigation is now a compact wrapped bar and the editor replaces the list until it is closed.

## Audit of the first build (2026-10-09)

A review of the 0.1 code found and fixed:

| Area           | Problem                                                                                                                                                     | Fix                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Content script | Two reloads (for example two quick settings changes) could run over the page at once, and a rule change mid-pass let the old rules finish their pass.       | Reloads are queued; every pass carries a generation number and stops at its next yield when the rules change. |
| Content script | Any storage change, such as pausing a different site, restored and re-applied every open page.                                                              | A reload only redoes the page when its own automatic rule set actually changed.                               |
| Page writes    | A page that keeps putting its own text back (framework re-render, ticker) alternated with Wordshift indefinitely.                                           | A node rewritten six times in ten seconds is left alone.                                                      |
| Undo           | Undoing a Quick Replace that sat on top of an automatic change made Wordshift forget the automatic text was its own, so the watcher could process it again. | The write log keeps the earlier write as Wordshift's.                                                         |
| Quick Replace  | The tab title counted as a match, so "1 of 4" started on text nobody could see or step to.                                                                  | Quick Replace searches page text only; automatic rules still cover the title.                                 |
| Popup          | Replies to fast typing could arrive out of order and show a stale count.                                                                                    | Each request is numbered; only the newest reply updates the view.                                             |
| Site patterns  | `https://example.com` (no trailing slash) never matched because the URL form required the whole URL to match.                                               | URL-form patterns match the start of the URL.                                                                 |
| Regex rules    | Patterns valid in classic JavaScript regex mode but not Unicode mode (`\-`, a lone `{`), common in FoxReplace lists, were rejected.                         | Compile falls back to classic mode when Unicode mode refuses the pattern.                                     |

UX changes from the same review: the product now has two execution modes—tab-scoped Quick Replace and automatic saved rules. The earlier manual-rule mode and shortcut were removed because they duplicated automatic rules without a clear visible result. The Library shows a banner with a switch when automatic rules are globally off; "Needs site access" on a rule is a button that asks for the permission; the rule editor focuses Find on open, closes on Escape, and says when "Only these sites" has no entries; the match-mode control supports arrow keys.

Design changes made during the build:

- **Quick Replace lives in the toolbar popup**, not a sidebar or side panel. activeTab is granted by the popup click, so no site access is needed for tab-scoped replacements. Highlights clear when the popup closes, while applied Quick changes remain active through reloads. A side panel can be added later if users want it to stay open.
- **Quick Replace is tab-scoped, not a saved rule mode.** Multiple Quick actions can be applied sequentially, survive reloads in that tab, and are listed with individual remove, Undo last, and Restore all controls. They clear when the tab or browser session ends. Pausing a site affects automatic rules only; Quick Replace remains available.
- **Catastrophic regexes cannot be interrupted mid-match.** JavaScript offers no way to stop a running `RegExp` call, and content-script workers are blocked by many page CSPs. Wordshift instead yields to the page between text nodes, caps nodes per pass, warns about nested repetition such as `(a+)+` in the editor and Quick Replace, and only runs one rule over one text node at a time (never the whole page as one string). The Phase 1 acceptance item about stopping `(a+)+$` mid-string is dropped.

---

## 1. Findings

Severity scale:

- **Critical**: lets untrusted input run code or exfiltrate data, or blocks the product direction.
- **High**: breaks pages, freezes tabs, or silently corrupts user data under realistic use.
- **Medium**: wrong or surprising behavior that users will hit, with a workaround.
- **Low**: maintenance cost, polish, or edge cases.

### Critical

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                                                                | Evidence                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| C1  | **Replacement "functions" are arbitrary JavaScript executed in every matching page.** `Substitution` compiles the rule output with `Function('match', ..., 'return ' + output)`. It runs in the content script, which is injected into all frames on all URLs and has the extension's privileges, so a function rule can read any page's DOM (including form field values) and send it anywhere.       | `scripts/core.js:132-135`; `manifest.json` content_scripts (`<all_urls>`, `all_frames: true`) |
| C2  | **Remote subscriptions can deliver that code.** When subscriptions are enabled, the background fetches the configured URL on a timer and calls `storage.setList(list)`, replacing the entire local list without preview or diff. Any function rules in the remote file then run on matching pages with no confirmation. Whoever controls the URL (or its hosting) controls code in the user's browser. | `scripts/subscription.js:83-90`                                                               |
| C3  | **The function feature cannot ship on Chromium Manifest V3 as built.** MV3 does not allow `unsafe-eval` in the extension CSP, and the Chrome Web Store prohibits remotely hosted code. The current CSP depends on `'unsafe-eval'`. Keeping functions requires either dropping them or isolating evaluation (for example, a sandboxed page). **(verify)** the exact MV3 options in Chrome and Firefox.  | `manifest.json` `content_security_policy`                                                     |

### High

| ID  | Finding                                                                                                                                                                                                                                                                                                            | Evidence                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| H1  | **HTML input/output mode replaces the whole document.** It serializes `/html` to a string, runs the rules over it, reparses it, and swaps `documentElement`. This destroys event listeners, framework state, iframes, media playback, and form input on the page.                                                  | `scripts/replace.js:220-232`                                     |
| H2  | **Script rewriting is available as a global preference.** With `replaceScripts` on, inline scripts are rewritten and re-inserted so they execute again with altered code.                                                                                                                                          | `scripts/replace.js:146-157`, `252-258`; `scripts/storage.js:37` |
| H3  | **HTML output mode injects parsed markup into the live page.** Replacement output is parsed with `DOMParser` and inserted as nodes. Combined with C2, a subscription can inject arbitrary markup such as links, forms, or tracking images.                                                                         | `scripts/replace.js:180-191`                                     |
| H4  | **No protection against slow regular expressions.** User and subscription regexes run synchronously over every text node, every attribute in the value XPath, and (in HTML mode) the entire serialized document. A backtracking pattern freezes the tab. There is no time budget, node budget, or page-size limit. | `scripts/core.js:59`, `scripts/replace.js:69-88`, `225-227`      |
| H5  | **User-typed text is modified by default.** The default replacement targets include `input[type=text]`, untyped inputs, textareas, and `@value` attributes, then dispatches synthetic `change` events. Auto-replace can therefore rewrite what a user is typing and trigger site logic.                            | `scripts/replace.js:91-143`                                      |
| H6  | **Import can hang permanently.** `importFromFile` sets `onload` but no `onerror` on the `FileReader`, so a read failure never settles the promise. The spinner stays visible and the modal refuses to close because `importing` stays `true`.                                                                      | `options/options.js:288-293`, `355-381`                          |
| H7  | **Function syntax errors surface only at replace time, inside the page.** The editor validates by constructing a `Substitution`, but the output function is compiled lazily on first match. A syntax error then throws inside `replaceWindow` and aborts all remaining rules for that pass.                        | `options/groupeditor.js:61-72`, `scripts/core.js:70-73`          |

### Medium

| ID  | Finding                                                                                                                                                                                                                                                                                                               | Evidence                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| M1  | **Dynamic content is only handled by polling.** Auto-replace runs once at `document_end`. The only follow-up is the optional periodic timer, which re-runs the whole list over the whole page in every active tab. There is no MutationObserver, so SPA and infinite-scroll content is missed or handled expensively. | `scripts/content.js:18-24`, `scripts/periodicreplace.js:29-38`, `scripts/background.js:30-37` |
| M2  | **URL scopes match as substrings.** Patterns compile to unanchored regexes and are tested against the full URL, so `example.com` also matches `https://other.test/?ref=example.com`. Anchors exist (`                                                                                                                 | `) but are opt-in and undocumented in the UI.                                                 | `scripts/core.js:267-273`, `295-296` |
| M3  | **Text inside `<style>` and `<noscript>` is treated as page text.** The XPath excludes only `script` parents, so rules can alter CSS.                                                                                                                                                                                 | `scripts/replace.js:65-66`                                                                    |
| M4  | **No schema validation on stored or imported data.** `substitutionListFromJSON` trusts `json.groups` and each field. Unknown `inputType` strings fall back silently, and an invalid regex anywhere in storage makes `getList()` reject, which stops all replacement.                                                  | `scripts/core.js:144-148`, `385-390`; `scripts/storage.js:19-24`                              |
| M5  | **Error messages lack location.** Import errors show `String(error)` with no group, rule, or field path.                                                                                                                                                                                                              | `options/options.js:312-316`, `331-335`                                                       |
| M6  | **Subscription URL and period changes do not restart the service.** The background reacts only to `enableSubscription` toggling, so editing the URL or period has no effect until the toggle is flipped.                                                                                                              | `scripts/background.js:58-61`                                                                 |
| M7  | **Shadow DOM is not traversed.** XPath does not enter shadow roots, so web-component text is never replaced.                                                                                                                                                                                                          | `scripts/replace.js:65-67`                                                                    |
| M8  | **Options UI density.** Groups, modes, HTML mode, URL lists, function output, global prefs, and subscriptions are all on one Bootstrap/ag-Grid page. Editing happens in a modal with tabs; new rows are added through a hidden trailing grid row.                                                                     | `options/options.html`, `options/groupeditor.js`                                              |
| M9  | **No feedback on what changed.** No match count, preview, highlight, dry run, undo, or indication that a page was modified.                                                                                                                                                                                           | All replace paths in `scripts/replace.js`                                                     |

### Low

| ID  | Finding                                                                                                                                                              | Evidence                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| L1  | Build script is a 2000s-era Mozillazine script using GNU-only `cp --parents`, so it fails on macOS, and it runs `rm -rf` on a configurable directory.                | `build.sh`, `config_build.sh`                                          |
| L2  | No package manifest, tests, lint, type checking, or CI.                                                                                                              | Repository root                                                        |
| L3  | Vendored, unpinned-by-manifest libraries (jQuery 3.7.0, Bootstrap, ag-Grid, XRegExp, Font Awesome 5.9.0). Native `\p{...}` regex support now covers the XRegExp use. | `lib/`                                                                 |
| L4  | Globals (`storage`, `subscription`, `Substitution`) shared across scripts by load order instead of modules.                                                          | `manifest.json` script arrays                                          |
| L5  | `Substitution` constructor defaults `outputType` to function output; all current callers pass it explicitly, but the unsafe default is a trap for new callers.       | `scripts/core.js:24`                                                   |
| L6  | Icon-only edit/delete controls, labels not bound to inputs, weak dark mode and narrow-width behavior.                                                                | `options/options.html`, `options/gridcomponents.js`                    |
| L7  | Help links and product strings point to FoxReplace.                                                                                                                  | `scripts/background.js:142`, `popup/toolbarbutton.js:80`, `_locales/*` |

### Handoff corrections

- "No handling of dynamic content" is slightly overstated: periodic replace exists (M1), but it is a coarse full-page timer, not change tracking.
- The import spinner issue is specific to file reads (H6). URL import handles errors and resets the spinner.

---

## 2. Safety model (decide before UI work)

The current capabilities define the permission story, so they are settled first.

| Capability                                                 | Wordshift 1.0                                                                                                   | Rationale                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Plain text, whole word, regex on text nodes                | Core                                                                                                            | The product's purpose.                                                 |
| Regex capture references (`$1`, `$<name>`) in plain output | Core                                                                                                            | Covers most of what users wrote functions for, with no code execution. |
| Replace in form fields                                     | Off by default, per rule opt-in                                                                                 | Avoids rewriting user input (H5).                                      |
| HTML output                                                | Removed from 1.0                                                                                                | Injection risk (H3); revisit as expert mode with a sanitizer.          |
| Whole-document HTML rewrite                                | Removed                                                                                                         | Breaks pages by design (H1).                                           |
| Script rewriting                                           | Removed                                                                                                         | Executes altered code (H2).                                            |
| URL attribute rewriting (`href`, `src`)                    | Expert mode, off by default                                                                                     | Useful but can redirect navigation.                                    |
| JavaScript functions                                       | Not in 1.0. Candidate expert feature later, evaluated in an isolated sandbox, never accepted from subscriptions | C1, C3.                                                                |
| Remote subscriptions                                       | Not in 1.0. Later: text rules only, manual "check for updates" with a diff and explicit accept                  | C2.                                                                    |

Imported FoxReplace rules that use removed capabilities are kept but disabled, flagged "needs review", with the original preserved (see Section 5).

---

## 3. Information architecture and primary flows

### Surfaces

1. **Popup (toolbar)**: page status and quick actions.
2. **Quick Replace panel** (sidebar in Firefox, side panel in Chromium): ad hoc find/replace on the current tab.
3. **Rule Library** (full-page options): manage saved rules, groups, sites, import/export, settings.

### Primary flows

1. **Tab-scoped replace**: open Quick Replace, type find text, see match count and highlights, step through matches, replace one or all, and keep the changes active through reloads until removed.
2. **Save as rule**: from Quick Replace, "Save as rule", choose site scope (this site / all sites / custom), choose group.
3. **Automatic rules**: in the Library, enable a rule or group for automatic application; the content script applies it on load and to new content.
4. **Is anything changing this page?**: popup shows which rules applied here and how many replacements, with a per-site pause.
5. **Migrate from FoxReplace**: export JSON from FoxReplace, import in Wordshift, review a report of converted, disabled, and flagged rules.
6. **Back up**: export JSON; import with append or replace, preview before commit.

---

## 4. Wireframe-level screens

### Popup

```
+--------------------------------------+
| Wordshift                     [gear]    |
| example.com                          |
| 3 rules applied, 41 replacements     |
| [ Pause automatic rules ]           |
|--------------------------------------|
| Quick Replace (this tab)             |
| Active here: 2 actions               |
| [ Undo last ] [ Restore all ]        |
|--------------------------------------|
| Auto-apply rules   (o) on            |
| Open Rule Library                    |
+--------------------------------------+
```

### Quick Replace panel

```
+--------------------------------------+
| Find     [colour            ] 12 hits|
| Replace  [color             ]        |
| [Aa] [Whole word] [.* Regex]         |
|  < prev   3 / 12   next >            |
| [Replace] [Replace all]  [Undo]      |
|--------------------------------------|
| Preview                              |
|  "...the colour of..." -> "color"    |
|  "...colours are..."   -> "colors"   |
|--------------------------------------|
| [ Save as rule... ]                  |
+--------------------------------------+
```

Regex errors show inline under the field with the error position. Highlights are rendered with the CSS Custom Highlight API where available **(verify)** so the DOM is untouched until the user commits.

### Rule Library

```
+---------------------------------------------------------------+
| Wordshift Rule Library          [Search rules...]  [+ New rule]  |
+----------------+----------------------------------------------+
| Groups         | Spelling (12 rules)            [on] [...]    |
|  All rules     |----------------------------------------------|
|  Spelling   12 | [on] colour -> color      All sites   Auto   |
|  Work       4  | [on] \bteh\b -> the       All sites   Auto   |
|  Needs review 2| [off] grey -> gray        *.gov.uk    Review |
|----------------|----------------------------------------------|
| Import         | Rule detail (right drawer on select)         |
| Export         |  Find / Replace / Match type / Case          |
| Settings       |  Sites: include / exclude list               |
|                |  Runs automatically                          |
|                |  Advanced (collapsed): form fields, attrs    |
|                |  Test box: paste text, see result            |
+----------------+----------------------------------------------+
```

Every control has a visible text label or `aria-label`, list rows are keyboard navigable, toggles are real switches, and destructive actions sit in an overflow menu with undo instead of a confirm dialog.

### Visual design principles

Clean, quiet, utilitarian. The interface is a tool, not a showcase.

- **Colour**: neutral greyscale for all surfaces, text, borders, and the primary button (near-black in light mode, near-white in dark). The only hues: a blue focus ring for keyboard users, a muted red for errors (text only), and a single yellow for match highlights on the page, following the browser's own find bar.
- **Type**: system font stack (`system-ui`), two weights (regular, semibold), three or four sizes. Monospace only for find/replace fields when regex mode is on.
- **Layout**: 4 px spacing grid, compact density, left-aligned content. Lists are plain rows separated by 1 px neutral dividers, not cards.
- **Borders and depth**: 1 px neutral borders on all sides; no coloured edge stripes. Small radius (4 to 6 px). Shadow only on floating layers (menus, popovers).
- **State**: shown with text labels, switches, and small neutral or accent dots, not colour-coded panels.
- **Icons**: one outline icon set, used only where the meaning is unambiguous and always paired with a label or tooltip.
- **Motion**: 150 ms or less, only for feedback (toggle, drawer open, undo toast). Disabled under `prefers-reduced-motion`.
- **Themes**: light and dark from the same tokens, following the system setting.
- **Excluded**: gradients, glassmorphism, glows, emoji, sparkle or "AI" iconography, hero banners, marketing taglines, cards inside cards, icons in coloured circles, badges on everything, oversized rounded corners, decorative illustrations.

Reference points for tone: the Firefox about:preferences page and the macOS System Settings lists, both plainer than typical extension UIs.

---

## 5. Migration plan

### Facts that shape the plan

- Wordshift uses a new Gecko ID, so FoxReplace's `browser.storage.local` data is not visible to it. Migration is by file: users export `FoxReplace.json` and import it into Wordshift.
- FoxReplace export format (version `2.6`; `0.14`, `0.15`, `2.1` also accepted upstream):

```json
{
  "version": "2.6",
  "groups": [
    {
      "name": "",
      "urls": ["example.com", "-example.com/admin"],
      "substitutions": [
        {
          "input": "",
          "inputType": "text|wholewords|regexp",
          "output": "",
          "outputType": "text|function",
          "caseSensitive": false
        }
      ],
      "html": "none|output|inputoutput",
      "enabled": true,
      "mode": "auto&manual|auto|manual"
    }
  ]
}
```

### Wordshift format (schema v2)

```json
{
  "format": "wordshift",
  "schemaVersion": 2,
  "groups": [{ "id": "", "name": "", "enabled": true }],
  "rules": [
    {
      "id": "",
      "groupId": "",
      "enabled": true,
      "order": 0,
      "find": "",
      "match": "text|word|regex",
      "caseSensitive": false,
      "replace": "",
      "sites": { "include": [], "exclude": [] },
      "targets": { "text": true, "formFields": false, "urlAttributes": false },
      "review": null,
      "legacy": null
    }
  ]
}
```

Validated with a JSON Schema at import and on every storage read; `schemaVersion` drives forward-only migrations kept as pure, unit-tested functions.

### Mapping

| FoxReplace                                            | Wordshift                                                           | Notes                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| group `name`, `enabled`                               | group                                                               | Empty names get the upstream default label.                                                                   |
| `urls` entries                                        | `sites.include`                                                     | Converted to match patterns; anchored by host. Ambiguous substring patterns are flagged.                      |
| `urls` entries starting with `-`                      | `sites.exclude`                                                     |                                                                                                               |
| `mode`                                                | automatic rule or disabled review item                              | Manual-only imports are disabled for review so they never become automatic silently.                          |
| `inputType`                                           | `match`                                                             | `wholewords` maps to `word`.                                                                                  |
| `outputType: text`                                    | `replace`                                                           | Upstream `\n`, `\t`, `\\` escapes preserved.                                                                  |
| `outputType: function`                                | rule disabled, `review: "function-output"`, source kept in `legacy` | Never executed. Simple cases (for example `match.toUpperCase()`) may be offered a suggested equivalent later. |
| `html: output` / `inputoutput`                        | rule disabled, `review: "html-mode"`                                |                                                                                                               |
| Pref `replaceUrls`                                    | `targets.urlAttributes` on imported rules                           | Only when the user enabled it upstream (not in export file; asked at import).                                 |
| Pref `replaceScripts`, periodic replace, subscription | Dropped, listed in the import report                                |                                                                                                               |

### Import report

After every import: counts of converted, disabled, and flagged rules, with each issue pointing to `groups[i].substitutions[j].field`, and a "Needs review" group in the Library.

---

## 6. Implementation sequence

Each phase ends in a working build. Acceptance criteria are written so they can be checked by tests or a short manual script.

### Phase 0: Foundation

- TypeScript, a small bundler (Vite or esbuild), `web-ext` for Firefox, ESLint, Prettier, Vitest, Playwright.
- MV3 manifest for Firefox and Chromium from one source, with per-browser overrides.
- CI: lint, typecheck, unit tests, build both targets, `web-ext lint`.
- Spike to confirm the **(verify)** items: MV3 CSP and sandbox options, Custom Highlight API support, side panel vs sidebar APIs.

Acceptance: `npm ci && npm test && npm run build` passes in CI; both builds load in their browsers and show a placeholder popup; manifests contain no `unsafe-eval` and no remote code.

### Phase 1: Safe replacement engine

- Pure core module: compile rule (text, word, regex with Unicode word boundaries), apply to a string, count matches. No DOM, no browser APIs.
- DOM walker using `TreeWalker` over text nodes; skips `script`, `style`, `noscript`, `template`, `textarea`, `input`, `contenteditable` by default; enters open shadow roots.
- Budgets: per-pass time slices and node limits with yields to the page; static warning for nested repetition (see Status).
- MutationObserver pipeline: batch added nodes and `characterData`, debounce, ignore mutations caused by Wordshift itself (loop prevention).
- Change journal per tab for undo (node reference, old text, new text).

Acceptance: unit tests cover each match type, case, word boundaries in Latin, CJK, and accented text, escapes, and capture references; large pages are processed in slices that yield to the page; Playwright fixtures for static pages, an SPA that inserts content, infinite scroll, iframes, and shadow DOM all show correct replacements; replacing then undoing restores byte-identical text; Wordshift's own writes do not re-trigger the observer.

### Phase 2: Storage, schema, and import/export

- Schema v1, validator, migration runner, FoxReplace importer, exporter, import report.

Acceptance: round-trip export then import is lossless; every upstream fixture version (`0.14`, `0.15`, `2.1`, `2.6`) imports with the documented mapping; function and HTML rules arrive disabled and flagged; malformed files produce errors with a JSON path; a corrupt storage entry is quarantined and does not stop other rules.

### Phase 3: UX rebuild

- Popup, Quick Replace, Rule Library as described in Section 4. Framework choice deferred to Phase 0 (Svelte or Preact keep bundles small).
- Accessibility: keyboard-only operation, visible focus, labelled controls, live region for match counts, WCAG 2.2 AA contrast in light and dark themes.

Acceptance: axe-core run in Playwright shows no serious or critical violations on all three surfaces; every flow in Section 3 completes by keyboard alone; layout holds from 320 px wide; popup reports correct rule and replacement counts on fixtures.

### Phase 4: Advanced features (post-1.0 candidates)

- URL attribute targets, form-field targets, per-site pause, activity history, tags, drag ordering.
- Optional expert features, each behind an explicit setting with a plain-language warning: sanitized HTML output; sandboxed function evaluation (never from imports or subscriptions); subscriptions with diff and manual accept.

Acceptance: each expert feature is off by default, cannot be enabled by an imported file, and has tests showing that disabled state blocks it end to end.

### Phase 5: Store release

- Narrowest workable permissions: evaluate `activeTab` plus optional host permissions requested per site, instead of install-time `<all_urls>`. Auto-apply on a site requests that site's permission at the time the user enables it.
- Store listings (AMO, Chrome Web Store, Edge), privacy statement ("no data collected"), screenshots, icons, changelog.

Acceptance: `web-ext lint` and Chrome Web Store pre-checks pass; a clean install with no rules requests no host permissions; signed builds install and pass the Playwright suite against the packaged artifacts.

---

## 7. Test strategy

| Layer                | Tool                                                                            | Covers                                                                                          |
| -------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Core logic           | Vitest                                                                          | Rule compilation, matching, escapes, budgets, schema validation, migrations, FoxReplace mapping |
| DOM engine           | Vitest + happy-dom or jsdom                                                     | Walker filters, journal and undo, observer batching                                             |
| Extension end to end | Playwright with built extension (Chromium); `web-ext run` smoke tests (Firefox) | Popup, panel, library flows, real pages from local fixtures                                     |
| Accessibility        | axe-core in Playwright                                                          | Each surface, light and dark                                                                    |
| Performance          | Playwright fixtures with timing assertions                                      | Large pages (1 MB text, 10k nodes), slow regex, mutation storms                                 |
| Packaging            | `web-ext lint`, manifest snapshot test                                          | No `unsafe-eval`, expected permissions only                                                     |

Fixtures live in `test/fixtures/` and include the upstream FoxReplace JSON versions.

---

## 8. Decisions

Made:

- Build from scratch rather than fork; license MIT; product name Wordshift.
- Toolchain WXT + Svelte 5 + TypeScript.
- Chromium and Firefox are built and tested from day one; Firefox ships first.

Open:

1. **Whether JavaScript functions return at all** (Phase 4) or are dropped permanently in favor of capture references.

Settled on 2026-10-12: the repo `BlueHarborWorks/wordshift` is public, with `main` as default, and the landing page in `site/` is published by GitHub Pages at https://blueharborworks.github.io/wordshift/. The `BlueHarborWorks/foxreplace` fork stays as a read-only reference.
