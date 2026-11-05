# Privacy

Wordshift finds and replaces text on web pages. It does this entirely inside your browser
(Firefox, Chrome, or another Chromium-based browser).

## Data collection

Wordshift does not collect, transmit, sell, or share personal data. It has no account system,
analytics, telemetry, advertising, remote code, cloud service, or network requests of its own.

## What it reads on web pages

To find and replace text, Wordshift reads the visible text of a page, and the page title when an
automatic rule matches it. It does this only:

- in the current tab, after you open the toolbar popup or press the keyboard shortcut (Quick Replace)
- on the sites you granted access to for automatic rules

Page text is processed on your device and is never stored or sent anywhere. Wordshift does not read
or change form fields, scripts, or page structure.

## Local storage

- Rules and settings are saved in the browser's local extension storage (`storage.local`).
- Quick Replace changes for a tab are kept in the browser's session storage (`storage.session`),
  together with that tab's address so they reapply only on the same page. They are removed when the
  tab closes or the browser quits.
- Export writes a JSON file to your computer, and import reads one. Nothing is uploaded.

## Permissions

- `storage` saves rules, settings, and Quick Replace changes locally.
- `activeTab` lets Quick Replace work on the current tab after you open it.
- `scripting` runs Wordshift's bundled content script on the current tab, or on the sites you granted.
- Site access (optional) is requested only when you turn on an automatic rule, for the sites that rule
  uses (all sites, if the rule runs everywhere). You can remove it at any time in Settings or in the
  browser's extension settings.

## Contact

Questions and reports: https://github.com/BlueHarborWorks/wordshift/issues
