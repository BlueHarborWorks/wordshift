// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { compilePattern, type PatternSpec } from '../src/core/compile';
import { PageReplacer, type ActiveRule } from '../src/dom/replacer';
import { collectTextNodes } from '../src/dom/textnodes';
import { ContentWatcher } from '../src/dom/watcher';

function active(id: string, spec: Partial<PatternSpec> & { find: string }): ActiveRule {
  const result = compilePattern({ replace: '', match: 'text', caseSensitive: false, ...spec });
  if (!result.ok) throw new Error(result.error);
  return { id, key: id, pattern: result.pattern };
}

const immediate = { yieldToPage: () => Promise.resolve() };
const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  document.head.innerHTML = '<title>Colour guide</title><style>.colour{}</style>';
  document.body.innerHTML = `
    <h1>Colour</h1>
    <p>The <b>colour</b> of the sky.</p>
    <script>var colour = 1;</script>
    <textarea>colour</textarea>
    <input value="colour">
    <div contenteditable="true">colour <span>colour</span></div>
    <noscript>colour</noscript>`;
});

describe('collectTextNodes', () => {
  it('returns readable text only, including the title', () => {
    const texts = collectTextNodes(document).map((n) => n.data.trim());
    expect(texts).toEqual(['Colour guide', 'Colour', 'The', 'colour', 'of the sky.']);
  });

  it('enters open shadow roots and reports them', () => {
    const host = document.createElement('div');
    host.attachShadow({ mode: 'open' }).innerHTML = '<p>shadow colour</p>';
    document.body.append(host);
    const roots: ShadowRoot[] = [];
    const texts = collectTextNodes(document.body, (r) => roots.push(r)).map((n) => n.data);
    expect(texts).toContain('shadow colour');
    expect(roots).toEqual([host.shadowRoot]);
  });

  it('can leave the title out, for Quick Replace', () => {
    const texts = collectTextNodes(document, undefined, { includeTitle: false }).map((n) => n.data.trim());
    expect(texts[0]).toBe('Colour');
  });

  it('ignores nodes inserted inside skipped elements', () => {
    const span = document.querySelector('[contenteditable] span')!;
    expect(collectTextNodes(span)).toEqual([]);
  });
});

describe('PageReplacer', () => {
  it('replaces page text and restores it exactly', async () => {
    const before = document.documentElement.outerHTML;
    const replacer = new PageReplacer(immediate);
    const result = await replacer.applyAuto(collectTextNodes(document), [
      active('r', { find: 'colour', replace: 'color' }),
    ]);

    expect(result.replacements).toBe(3);
    expect(document.title).toBe('color guide');
    expect(document.querySelector('textarea')!.value).toBe('colour');
    expect(document.querySelector('script')!.textContent).toContain('colour');
    expect(replacer.autoCounts.get('r')).toBe(3);

    replacer.restoreAll();
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it('does not reprocess its own writes', async () => {
    const replacer = new PageReplacer(immediate);
    const grow = [active('r', { find: 'sky', replace: 'sky sky' })];
    await replacer.applyAuto(collectTextNodes(document), grow);
    await replacer.applyAuto(collectTextNodes(document), grow);
    expect(document.body.textContent).toContain('of the sky sky.');
    expect(document.body.textContent).not.toContain('sky sky sky');
  });

  it('undoes only the last Quick Replace action', async () => {
    const replacer = new PageReplacer(immediate);
    await replacer.applyAuto(collectTextNodes(document), [active('r', { find: 'sky', replace: 'sea' })]);

    const pattern = active('q', { find: 'colour', replace: 'hue' }).pattern;
    const first = replacer.find(collectTextNodes(document), pattern);
    expect(first).toHaveLength(3);
    replacer.replaceMatches([first[1]!]);
    expect(document.querySelector('h1')!.textContent).toBe('hue');
    replacer.replaceMatches(replacer.find(collectTextNodes(document), pattern));
    expect(document.querySelector('b')!.textContent).toBe('hue');

    replacer.undoLast();
    expect(document.querySelector('h1')!.textContent).toBe('hue');
    expect(document.querySelector('b')!.textContent).toBe('colour');
    expect(document.body.textContent).toContain('sea');
    expect(replacer.canUndo).toBe(true);
  });

  it('restores one Quick Replace action without removing another', () => {
    const replacer = new PageReplacer(immediate);
    const h1 = document.querySelector('h1')!.firstChild as Text;
    const paragraph = document.querySelector('p')!.lastChild as Text;
    const firstAction = replacer.newAction();
    const secondAction = replacer.newAction();

    replacer.replaceMatches(replacer.find([h1], active('q1', { find: 'Colour', replace: 'Hue' }).pattern), firstAction);
    replacer.replaceMatches(
      replacer.find([paragraph], active('q2', { find: 'sky', replace: 'sea' }).pattern),
      secondAction,
    );
    expect(h1.data).toBe('Hue');
    expect(paragraph.data).toContain('sea');

    replacer.restoreAction(firstAction);
    expect(h1.data).toBe('Colour');
    expect(paragraph.data).toContain('sea');
    expect(replacer.canUndo).toBe(true);
  });

  it('replays a newer Quick action on the same text node when an older one is restored', () => {
    document.body.innerHTML = '<p>colour sky</p>';
    const node = document.querySelector('p')!.firstChild as Text;
    const replacer = new PageReplacer(immediate);
    const firstAction = replacer.newAction();
    replacer.replaceMatches(
      replacer.find([node], active('q1', { find: 'colour', replace: 'hue' }).pattern),
      firstAction,
    );
    replacer.replaceMatches(replacer.find([node], active('q2', { find: 'sky', replace: 'sea' }).pattern));
    expect(node.data).toBe('hue sea');

    replacer.restoreAction(firstAction);
    expect(node.data).toBe('colour sea');
    replacer.undoLast();
    expect(node.data).toBe('colour sky');
  });

  it('does not clobber text the page changed after Wordshift did', async () => {
    const replacer = new PageReplacer(immediate);
    await replacer.applyAuto(collectTextNodes(document), [active('r', { find: 'colour', replace: 'color' })]);
    const h1 = document.querySelector('h1')!;
    h1.firstChild!.textContent = 'Updated by page';
    replacer.restoreAll();
    expect(h1.textContent).toBe('Updated by page');
  });

  it('yields to the page between slices on large pages', async () => {
    document.body.innerHTML = Array.from({ length: 5000 }, (_, i) => `<p>item colour ${i}</p>`).join('');
    let clock = 0;
    let yields = 0;
    const replacer = new PageReplacer({
      sliceMs: 10,
      now: () => (clock += 1),
      yieldToPage: async () => {
        yields++;
      },
    });
    const result = await replacer.applyAuto(collectTextNodes(document.body), [
      active('r', { find: 'colour', replace: 'c' }),
    ]);
    expect(result.replacements).toBe(5000);
    expect(yields).toBeGreaterThan(100);
  });

  it('stops at the next yield once cancelled', async () => {
    document.body.innerHTML = Array.from({ length: 50 }, (_, i) => `<p>colour ${i}</p>`).join('');
    let clock = 0;
    let cancelled = false;
    const replacer = new PageReplacer({
      sliceMs: 1,
      now: () => (clock += 1),
      yieldToPage: async () => {
        cancelled = true;
      },
    });
    const result = await replacer.applyAuto(
      collectTextNodes(document.body),
      [active('r', { find: 'colour', replace: 'c' })],
      {
        cancelled: () => cancelled,
      },
    );
    expect(result.replacements).toBeGreaterThan(0);
    expect(result.replacements).toBeLessThan(50);
  });

  it('gives up on a node the page keeps rewriting', async () => {
    const replacer = new PageReplacer(immediate);
    const rules = [active('r', { find: 'colour', replace: 'color' })];
    const h1 = document.querySelector('h1')!.firstChild as Text;
    let writes = 0;
    for (let i = 0; i < 10; i++) {
      h1.data = 'Colour guide'; // the page puts its own text back
      const result = await replacer.applyAuto([h1], rules);
      writes += result.nodesChanged;
    }
    expect(writes).toBe(6);
    expect(h1.data).toBe('Colour guide');
  });

  it('keeps an automatic write recognisable after undoing a Quick Replace on top of it', async () => {
    const replacer = new PageReplacer(immediate);
    const h1 = document.querySelector('h1')!.firstChild as Text;
    await replacer.applyAuto([h1], [active('r', { find: 'colour', replace: 'color' })]);
    const pattern = active('q', { find: 'color', replace: 'hue' }).pattern;
    replacer.replaceMatches(replacer.find([h1], pattern));
    expect(h1.data).toBe('hue');
    replacer.undoLast();
    expect(h1.data).toBe('color');
    expect(replacer.isOwnWrite(h1)).toBe(true);
  });

  it('does not resurrect a paused automatic change when Quick changes are restored', async () => {
    const replacer = new PageReplacer(immediate);
    const h1 = document.querySelector('h1')!.firstChild as Text;
    await replacer.applyAuto([h1], [active('r', { find: 'colour', replace: 'color' })]);
    const pattern = active('q', { find: 'color', replace: 'hue' }).pattern;
    replacer.replaceMatches(replacer.find([h1], pattern));

    replacer.restoreAuto();
    expect(h1.data).toBe('hue');
    replacer.restoreQuick();
    expect(h1.data).toBe('Colour');
  });

  it('stops at the node limit and says so', async () => {
    const replacer = new PageReplacer({ ...immediate, maxNodes: 2 });
    const result = await replacer.applyAuto(collectTextNodes(document), [
      active('r', { find: 'colour', replace: 'c' }),
    ]);
    expect(result.truncated).toBe(true);
  });
});

describe('ContentWatcher', () => {
  it('reports inserted and edited text, but not Wordshift writes', async () => {
    const replacer = new PageReplacer(immediate);
    const rules = [active('r', { find: 'colour', replace: 'color' })];
    const seen: string[][] = [];
    const watcher = new ContentWatcher(
      (nodes) => {
        seen.push(nodes.map((n) => n.data));
        void replacer.applyAuto(nodes, rules);
      },
      (node) => replacer.isOwnWrite(node),
      { debounceMs: 5 },
    );
    watcher.observe(document);

    const p = document.createElement('p');
    p.textContent = 'new colour';
    document.body.append(p);
    await tick(30);
    expect(p.textContent).toBe('new color');

    p.firstChild!.textContent = 'edited colour';
    await tick(30);
    expect(p.textContent).toBe('edited color');

    // Wordshift's own writes produced mutations too; they must not have been reported.
    expect(seen).toEqual([['new colour'], ['edited colour']]);
    watcher.disconnect();
  });

  it('can discard mutations caused by restoring text', async () => {
    const replacer = new PageReplacer(immediate);
    await replacer.applyAuto(collectTextNodes(document), [active('r', { find: 'colour', replace: 'color' })]);
    const seen: Text[][] = [];
    const watcher = new ContentWatcher(
      (nodes) => seen.push(nodes),
      () => false,
      { debounceMs: 5 },
    );
    watcher.observe(document);
    replacer.restoreAll();
    watcher.discardPending();
    await tick(30);
    expect(seen).toEqual([]);
    watcher.disconnect();
  });
});
