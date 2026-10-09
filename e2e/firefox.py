"""
Drives a real, headless Firefox with the Wordshift test build and checks the main flows.

    npm run e2e:firefox

Needs Firefox 142+ at /Applications/Firefox.app (or FIREFOX_BIN), geckodriver on PATH, and the
`selenium` Python package (pip install selenium). The Chromium suite in extension.spec.ts is the
primary one; this script covers the browser the extension ships to first.
"""

import http.server
import json
import os
import re
import socketserver
import sys
import threading
import time
import uuid
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / '.output-e2e' / 'firefox-mv3'
FOX_FIXTURE = ROOT / 'test' / 'fixtures' / 'foxreplace-2.6.json'
FIREFOX_BIN = os.environ.get('FIREFOX_BIN', '/Applications/Firefox.app/Contents/MacOS/firefox')
UUID = '3f2a6c1e-0000-4000-8000-000000000001'
BASE = f'moz-extension://{UUID}/'

# The same page the Chromium suite uses, pulled from fixtures.ts so the two stay identical.
PAGE_HTML = re.search(r'export const PAGE_HTML = `(.*?)`;', (ROOT / 'e2e' / 'fixtures.ts').read_text(), re.S).group(1)

results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)


def wait_for(fn, timeout=6.0):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            last = fn()
            if last:
                return last
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(0.15)
    return last


def ext_call(d, js):
    """Runs async JS in an extension page; `js` must evaluate to a promise."""
    return d.execute_async_script(
        'const done = arguments[arguments.length - 1];'
        f'Promise.resolve().then(() => {js}).then(r => done(JSON.parse(JSON.stringify(r ?? null))), e => done({{error: String(e)}}));'
    )


def rule(**fields):
    base = dict(id=str(uuid.uuid4()), groupId=None, enabled=True, replace='', match='text', caseSensitive=False,
                sites=dict(include=[], exclude=[]), apply=dict(auto=True, manual=True), review=None)
    base.update(fields)
    return base


def library(rules):
    return dict(format='wordshift', schemaVersion=1, groups=[], rules=rules)


class FixtureHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        body = PAGE_HTML.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # noqa: D102
        pass


if not EXT.exists():
    sys.exit(f'{EXT} is missing. Run: WORDSHIFT_E2E=1 npx wxt build -b firefox')

server = socketserver.TCPServer(('127.0.0.1', 0), FixtureHandler)
threading.Thread(target=server.serve_forever, daemon=True).start()
PAGE = f'http://127.0.0.1:{server.server_address[1]}/page.html'
PAGE_HOST = '127.0.0.1'

opts = Options()
opts.binary_location = FIREFOX_BIN
opts.add_argument('-headless')
opts.set_preference('extensions.webextensions.uuids', json.dumps({'wordshift@blueharborworks': UUID}))
d = webdriver.Firefox(options=opts, service=Service(service_args=['--allow-system-access']))
d.set_window_size(1200, 900)
try:
    print('Firefox', d.capabilities.get('browserVersion'))
    d.install_addon(str(EXT), temporary=True)
    time.sleep(1)

    # Marionette refuses to navigate to moz-extension URLs, so open the first one from the browser chrome.
    before_handles = set(d.window_handles)
    d.set_context('chrome')
    d.execute_script(
        'gBrowser.selectedTab = gBrowser.addTab(arguments[0], '
        '{ triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });',
        BASE + 'options.html',
    )
    d.set_context('content')
    ext_tab = wait_for(lambda: (set(d.window_handles) - before_handles) and list(set(d.window_handles) - before_handles)[0])
    d.switch_to.window(ext_tab)
    wait_for(lambda: d.execute_script('return document.readyState') == 'complete' and d.current_url.startswith('moz-extension'))

    perms = ext_call(d, 'browser.permissions.getAll()')
    check('host access granted to test build', '<all_urls>' in (perms or {}).get('origins', []), json.dumps(perms))

    # 1. Automatic rules
    ext_call(d, f'browser.storage.local.set({{ library: {json.dumps(library([rule(find="colour", replace="color", match="word")]))} }})')
    reg = wait_for(lambda: ext_call(d, 'browser.scripting.getRegisteredContentScripts()'))
    check('content script registered for automatic rules', reg and len(reg) == 1)

    d.switch_to.new_window('tab')
    page_tab = d.current_window_handle
    d.get(PAGE)
    check('automatic rule replaced heading', wait_for(lambda: d.find_element(By.TAG_NAME, 'h1').text == 'color guide'),
          d.find_element(By.TAG_NAME, 'h1').text)
    check('page title replaced', wait_for(lambda: d.title == 'color test'), d.title)
    check('textarea left alone', d.find_element(By.ID, 't').get_attribute('value') == 'colour')
    check('late-loading content replaced', wait_for(lambda: d.find_element(By.ID, 'late').text == 'Late color content'))

    # 2. Pause restores original text
    d.switch_to.window(ext_tab)
    ext_call(d, "browser.storage.local.set({ settings: { autoApply: true, pausedSites: ['%s'] } })" % PAGE_HOST)
    d.switch_to.window(page_tab)
    check('pausing the site restores original text', wait_for(lambda: d.find_element(By.TAG_NAME, 'h1').text == 'Colour guide'),
          d.find_element(By.TAG_NAME, 'h1').text)

    # 3. Quick Replace through the popup page (no automatic rules)
    d.switch_to.window(ext_tab)
    ext_call(d, "browser.storage.local.set({ settings: { autoApply: true, pausedSites: [] }, library: %s })"
             % json.dumps(library([])))
    d.switch_to.window(page_tab)
    d.get(PAGE)
    wait_for(lambda: d.find_elements(By.ID, 'late'))
    d.switch_to.window(ext_tab)
    tabs = ext_call(d, "browser.tabs.query({}).then(ts => ts.map(t => [t.id, t.url]))")
    tab_id = next(t[0] for t in tabs if t[1] and t[1].startswith(PAGE))
    before_handles = set(d.window_handles)
    ext_call(d, f"browser.tabs.create({{ url: '/popup.html?tab={tab_id}' }})")
    popup_tab = wait_for(lambda: list(set(d.window_handles) - before_handles)[0])
    d.switch_to.window(popup_tab)
    find = wait_for(lambda: d.find_element(By.ID, 'find'))
    find.send_keys('colour')
    status = lambda: d.find_element(By.ID, 'find-status').text  # noqa: E731
    check('Quick Replace counts matches (tab title excluded)', wait_for(lambda: status() == '1 of 3'), status())
    d.find_element(By.ID, 'replace').send_keys('hue')
    time.sleep(0.4)
    find.send_keys(Keys.ENTER)
    check('Enter steps to the next match', wait_for(lambda: status() == '2 of 3'), status())
    check('Apply manual rules is disabled with no manual rules',
          d.find_element(By.XPATH, "//button[normalize-space()='Apply manual rules']").get_attribute('disabled') is not None)
    d.find_element(By.XPATH, "//button[normalize-space()='Replace all']").click()
    check('Replace all reports no matches left', wait_for(lambda: status() == 'No matches'), status())
    d.switch_to.window(page_tab)
    check('Replace all changed the page', d.find_element(By.ID, 'p').text == 'The hue of the sea.')
    d.switch_to.window(popup_tab)
    d.find_element(By.XPATH, "//button[normalize-space()='Undo']").click()
    time.sleep(0.4)
    d.switch_to.window(page_tab)
    check('Undo restored the page', wait_for(lambda: d.find_element(By.ID, 'p').text == 'The colour of the sea.'))

    # 4. Rule Library: create a rule and import a FoxReplace file
    d.switch_to.window(ext_tab)
    d.execute_script('location.reload()')
    time.sleep(0.8)
    wait_for(lambda: d.find_element(By.XPATH, "//button[normalize-space()='New rule']")).click()
    find_field = wait_for(lambda: d.find_element(By.ID, 'rule-find'))
    check('editor focuses the Find field', d.switch_to.active_element == find_field)
    find_field.send_keys('teh')
    d.find_element(By.ID, 'rule-replace').send_keys('the')
    d.find_element(By.XPATH, "//button[@role='radio' and normalize-space()='Word']").click()
    d.find_element(By.ID, 'rule-sample').send_keys('teh cat sat on tehm')
    check('rule editor preview', wait_for(lambda: 'the cat sat on tehm' in d.find_element(By.CLASS_NAME, 'preview').text))
    d.find_element(By.XPATH, "//button[normalize-space()='Save']").click()
    check('new rule saved and listed', wait_for(lambda: len(d.find_elements(By.CSS_SELECTOR, '.rule-list li')) == 1))
    d.find_element(By.XPATH, "//button[normalize-space()='Import']").click()
    d.find_element(By.ID, 'import-file').send_keys(str(FOX_FIXTURE))
    check('FoxReplace import report', wait_for(lambda: 'from a FoxReplace file' in d.find_element(By.CLASS_NAME, 'report').text))
    d.find_element(By.XPATH, "//button[normalize-space()='Add to my rules']").click()
    check('import opens Needs review with the 2 flagged rules',
          wait_for(lambda: len(d.find_elements(By.CSS_SELECTOR, '.rule-list li')) == 2))
    d.find_element(By.XPATH, "//nav//button[starts-with(normalize-space(), 'All rules')]").click()
    check('imported rules listed', wait_for(lambda: len(d.find_elements(By.CSS_SELECTOR, '.rule-list li')) == 7))

    # 5. A real website (skipped offline)
    if not os.environ.get('WORDSHIFT_OFFLINE'):
        real = 'https://en.wikipedia.org/wiki/Harbor'
        ext_call(d, f'browser.storage.local.set({{ library: {json.dumps(library([rule(find="harbor", replace="port", match="word")]))} }})')
        wait_for(lambda: len(ext_call(d, 'browser.scripting.getRegisteredContentScripts()') or []) == 1)
        d.switch_to.window(page_tab)
        d.get(real)
        time.sleep(2.5)
        harbors = d.execute_script("return (document.body.innerText.match(/\\bharbor\\b/gi) || []).length")
        ports = d.execute_script("return (document.body.innerText.match(/\\bport\\b/gi) || []).length")
        links = d.execute_script("return document.querySelectorAll('a[href]').length")
        check('real site (Wikipedia): rule applied and page intact', harbors == 0 and ports > 0 and links > 100,
              f'harbor={harbors}, port={ports}, links={links}')
finally:
    d.quit()
    server.shutdown()

failed = [r for r in results if not r[1]]
print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
sys.exit(1 if failed else 0)
