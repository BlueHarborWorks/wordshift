/** Elements whose text is code, styling, or user input rather than readable page text. */
const SKIP_ELEMENTS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'textarea',
  'input',
  'select',
  'iframe',
  'object',
  'embed',
  'canvas',
  'math',
]);

export function isSkippedElement(element: Element): boolean {
  if (SKIP_ELEMENTS.has(element.localName)) return true;
  // Leave anything the user is editing alone.
  return (element as HTMLElement).isContentEditable === true;
}

/** True when the node's text is page text Wordshift may change. */
export function isEligibleText(node: Text): boolean {
  if (!/\S/.test(node.data)) return false;
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (isSkippedElement(el)) return false;
  }
  return true;
}

/**
 * Text nodes under `root` that hold readable page text: light DOM in document order, then shadow DOM.
 * Enters open shadow roots. For a Document, also includes the <title>.
 */
export function collectTextNodes(root: Node, onShadowRoot?: (root: ShadowRoot) => void): Text[] {
  const out: Text[] = [];

  if (root.nodeType === Node.TEXT_NODE) {
    const text = root as Text;
    if (isEligibleText(text)) out.push(text);
    return out;
  }

  if (root.nodeType === Node.DOCUMENT_NODE) {
    const doc = root as Document;
    const title = doc.querySelector('head > title');
    if (title) walk(title, out, onShadowRoot);
    if (doc.body) walk(doc.body, out, onShadowRoot);
    return out;
  }

  if (root.nodeType === Node.ELEMENT_NODE) {
    // An inserted subtree may sit inside a skipped ancestor such as a contenteditable editor.
    for (let el = (root as Element).parentElement; el; el = el.parentElement) {
      if (isSkippedElement(el)) return out;
    }
  }
  walk(root, out, onShadowRoot);
  return out;
}

function walk(root: Node, out: Text[], onShadowRoot?: (root: ShadowRoot) => void): void {
  if (root.nodeType === Node.ELEMENT_NODE && isSkippedElement(root as Element)) return;

  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        return isSkippedElement(node as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
      return /\S/.test((node as Text).data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });

  const shadowHosts: Element[] = [];
  if (root.nodeType === Node.ELEMENT_NODE && (root as Element).shadowRoot) shadowHosts.push(root as Element);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) out.push(node as Text);
    else if ((node as Element).shadowRoot) shadowHosts.push(node as Element);
  }

  for (const host of shadowHosts) {
    const shadow = host.shadowRoot!;
    onShadowRoot?.(shadow);
    walk(shadow, out, onShadowRoot);
  }
}
