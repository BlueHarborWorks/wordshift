# Chrome Web Store submission: Wordshift

Everything needed to submit Wordshift in the Chrome Web Store Developer Dashboard
(https://chrome.google.com/webstore/devconsole). Text in code blocks is meant to be pasted as-is.

Published listing (item ID `pfjgkfknmgfknbjadjboehbbnhlmclde`, first published 2026-11-04 as 0.1.2):
https://chromewebstore.google.com/detail/wordshift/pfjgkfknmgfknbjadjboehbbnhlmclde

## Before you start

- The privacy policy URL below must resolve, so `PRIVACY.md` has to be on `main` on GitHub.
- Build the package: `npm ci && npm run zip` creates `.output/wordshift-0.1.3-chrome.zip`.
- Do not create API keys, change account settings other than those listed here, or put the account
  owner's email address in any public field.

## 1. Account (one time, shared by all items)

Dashboard > **Account** (Settings):

- **Publisher name**: `Blue Harbor Works`
- **Contact email**: must be verified before an item can be submitted. If it is missing or not
  verified, stop and ask the account owner. Do not enter an address yourself.
- **Trader / non-trader declaration** (EU Digital Services Act): this is a legal declaration for the
  account owner to make. Stop and ask if it has not been answered.

## 2. Create the item

**+ New item** > upload `.output/wordshift-0.1.3-chrome.zip`. Expected: no errors. The package is
Manifest V3, version 0.1.3, `minimum_chrome_version` 111, permissions `storage`, `activeTab`,
`scripting`, optional host permission `<all_urls>`, no remote code.

## 3. Store listing tab

**Description**

```
Wordshift finds and replaces text on web pages. Use Quick Replace for a one-off change in the current tab, or save rules that run automatically on the sites you choose.

Quick Replace
- Open it from the toolbar or with Alt+Shift+F.
- See a live match count, highlight matches, and step through them one at a time.
- Replace one match or all of them. Changes stay in that tab and reapply after reloads until you remove them or close the tab.

Automatic rules
- Run on every visit to the sites you choose, including text that loads later.
- Match anywhere, whole words only, or with a regular expression, with or without matching case.
- Limit a rule to certain sites, or run it everywhere except certain sites.
- Organize rules into groups, turn groups on and off, and pause automatic rules on a site.
- Test a rule on sample text before saving it.

Safe by design
- Wordshift changes only visible text. It does not run code from rules, rewrite HTML or scripts, or touch form fields and what you type.
- Every change can be undone.

Minimal permissions
- No site access at install. Quick Replace works on the current tab after you open it.
- Automatic rules ask for access only to the sites they use, and you can remove that access at any time.

Private
- No account, analytics, telemetry, or network requests. Rules and settings stay in your browser.
- Export rules as a JSON file and import them in another browser profile or on another device.

Wordshift is open source under the MIT License.
```

- **Category**: Productivity > Tools
- **Language**: English
- **Store icon** (128x128): `public/icon/128.png`
- **Screenshots** (1280x800), in this order:
  1. `store/chrome/screenshot-1-quick-replace.png`
  2. `store/chrome/screenshot-2-rule-library-light.png`
  3. `store/chrome/screenshot-3-rule-library-dark.png`
- **Small promo tile** (440x280): `store/chrome/promo-small-440x280.png`
- **Marquee promo tile**: leave empty (optional).
- **Homepage URL**: `https://blueharborworks.github.io/wordshift/`
- **Support URL**: `https://github.com/BlueHarborWorks/wordshift/issues`
- **Mature content**: No.

## 4. Privacy tab

**Single purpose description**

```
Find and replace text on web pages, either in the current tab on request (Quick Replace) or automatically on sites the user chooses (rules).
```

**Permission justifications**

`storage`

```
Saves the user's rules and settings in storage.local, and keeps Quick Replace changes for a tab in storage.session so they reapply after a reload until the tab closes.
```

`activeTab`

```
Quick Replace works on the current tab only after the user opens the toolbar popup or presses the keyboard shortcut. No site access is requested for this.
```

`scripting`

```
Injects Wordshift's bundled content script, which finds and replaces visible text, into the current tab for Quick Replace, and registers it on the sites the user has granted for automatic rules.
```

Host permission (`<all_urls>`, optional)

```
Declared as optional and not granted at install. When the user turns on an automatic rule, Wordshift requests access only to the sites that rule lists, or to all sites if the user sets the rule to run everywhere, so the rule can apply when those pages load. The user can remove this access at any time in Wordshift's Settings or in Chrome's extension settings.
```

**Remote code**: No, I am not using remote code. (All JavaScript is bundled in the package.)

**Data usage**. Chrome's User Data FAQ says data handled only on the device still has to be
disclosed. Recommended answers:

- [x] **Website content**: Wordshift reads page text to find and replace it. This happens on the
      device and the text is never stored or transmitted.
- [x] **Web history**: the address of a tab with active Quick Replace changes is kept in session
      storage until the tab closes, so the changes reapply only on the same page.
- All other categories: unchecked.
- Certify all three statements (no sale or transfer to third parties, no use unrelated to the single
  purpose, no use for creditworthiness or lending).

**Privacy policy URL**: `https://github.com/BlueHarborWorks/wordshift/blob/main/PRIVACY.md`

## 5. Distribution tab

- **Payments**: Free
- **Visibility**: Public
- **Regions**: All regions

## 6. Test instructions tab (for reviewers)

```
No account or credentials are needed.
Quick Replace: open any web page with text, click the Wordshift toolbar button (or press Alt+Shift+F), type a word that appears on the page in Find and a replacement in Replace with, then click Replace all. Click Undo last in the popup to revert it.
Automatic rules: click Open Rule Library, choose New rule, enter a word and a replacement, keep "All sites", and save. Chrome asks for site access at that point. Reload any page containing the word to see it replaced.
Source code: https://github.com/BlueHarborWorks/wordshift
```

## 7. Submit

Click **Submit for review**. Leave "publish automatically after approval" on unless the account owner
asks otherwise. Report back the status shown (normally "Pending review") and any warnings, quoted
exactly.
