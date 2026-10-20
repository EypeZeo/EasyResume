const MESSAGE = '点击消息，可以直接跟招聘方聊天啦~';
const ACKNOWLEDGEMENT = '我知道了';
const attemptedDocuments = new WeakSet<Document>();
const clearingDocuments = new WeakSet<Document>();
const compact = (value: string | null) => (value ?? '').replace(/\s+/g, '').replace(/～/g, '~');

function visible(element: Element): boolean {
  if (!element.isConnected) return false;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (
      current.hasAttribute('hidden') ||
      current.getAttribute('aria-hidden') === 'true' ||
      style?.display === 'none' ||
      style?.visibility === 'hidden' ||
      style?.opacity === '0'
    )
      return false;
  }
  const rect = element.getBoundingClientRect();
  const view = element.ownerDocument.defaultView;
  return (
    !!view &&
    [
      rect.left,
      rect.top,
      rect.right,
      rect.bottom,
      rect.width,
      rect.height,
      view.innerWidth,
      view.innerHeight,
    ].every(Number.isFinite) &&
    rect.width > 0 &&
    rect.height > 0 &&
    view.innerWidth > 0 &&
    view.innerHeight > 0 &&
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < view.innerWidth &&
    rect.top < view.innerHeight
  );
}

function overlays(document: Document): Element[] {
  const view = document.defaultView;
  if (!view) return [];
  return [
    ...document.querySelectorAll('[class], [aria-modal="true"], [role="dialog"], dialog[open]'),
  ].filter((element) => {
    const modal = element.matches('[aria-modal="true"], [role="dialog"], dialog[open]');
    if (!modal && !/(?:mask|overlay)/i.test(element.getAttribute('class') ?? '')) return false;
    if (!visible(element)) return false;
    const style = view.getComputedStyle(element);
    if (style.pointerEvents === 'none') return false;
    if (modal) return true;
    if (!['fixed', 'absolute'].includes(style.position)) return false;
    const rect = element.getBoundingClientRect();
    const width = Math.min(rect.right, view.innerWidth) - Math.max(rect.left, 0);
    const height = Math.min(rect.bottom, view.innerHeight) - Math.max(rect.top, 0);
    return (
      width >= view.innerWidth * 0.6 &&
      height >= view.innerHeight * 0.6 &&
      width * height >= view.innerWidth * view.innerHeight * 0.5
    );
  });
}

type Guide = { root: HTMLElement; acknowledgement: HTMLElement };

function guides(document: Document): Guide[] {
  const result: Guide[] = [];
  for (const leaf of document.querySelectorAll<HTMLElement>('body *')) {
    if (leaf.childElementCount || compact(leaf.textContent) !== ACKNOWLEDGEMENT || !visible(leaf))
      continue;
    let root = leaf.parentElement;
    for (let depth = 0; root && depth < 5; depth++, root = root.parentElement) {
      if (root === document.body || root === document.documentElement) break;
      const text = compact(root.textContent);
      if (text.length > 100) break;
      if (text !== MESSAGE + ACKNOWLEDGEMENT) continue;
      const rect = root.getBoundingClientRect();
      const view = document.defaultView!;
      if (
        visible(root) &&
        rect.width <= view.innerWidth &&
        rect.height <= view.innerHeight * 0.4 &&
        rect.width * rect.height <= view.innerWidth * view.innerHeight * 0.4
      ) {
        result.push({
          root,
          acknowledgement: leaf.closest<HTMLElement>('button, [role="button"]') ?? leaf,
        });
      }
      break;
    }
  }
  return result;
}

function safeAcknowledgement({ root, acknowledgement }: Guide): boolean {
  if (
    compact(root.textContent) !== MESSAGE + ACKNOWLEDGEMENT ||
    !root.contains(acknowledgement) ||
    compact(acknowledgement.textContent) !== ACKNOWLEDGEMENT ||
    acknowledgement.matches(':disabled, [aria-disabled="true"]') ||
    acknowledgement.closest('a, form, [href], [formaction]') ||
    root.querySelector('form, input, textarea, select, iframe, a, [href], [formaction]') ||
    acknowledgement.matches('button[type="submit"], button[type="reset"]')
  )
    return false;
  const interactive = [
    ...root.querySelectorAll<HTMLElement>(
      'button, [role="button"], [onclick], [tabindex], summary, [contenteditable="true"]',
    ),
  ];
  return interactive.every(
    (element) => element === acknowledgement || acknowledgement.contains(element),
  );
}

function acknowledgementIsUnobstructed(element: HTMLElement): boolean {
  const document = element.ownerDocument;
  const view = document.defaultView;
  if (!view) return false;
  const rect = element.getBoundingClientRect();
  const left = Math.max(0, rect.left);
  const right = Math.min(view.innerWidth, rect.right);
  const top = Math.max(0, rect.top);
  const bottom = Math.min(view.innerHeight, rect.bottom);
  if (right <= left || bottom <= top) return false;
  const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
  // HTMLElement.click() skips hit testing, so never click through another modal or mask.
  return !!hit && (hit === element || element.contains(hit));
}

function supported(href: string): boolean {
  try {
    const url = new URL(href);
    return (
      url.protocol === 'https:' &&
      ['www.zhaopin.com', 'zhaopin.com'].includes(url.hostname) &&
      !url.port &&
      !url.username &&
      !url.password &&
      /^\/(?:jobs|recommend)(?:\/|$)/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export class OnboardingBlocked extends Error {
  readonly code = 'ONBOARDING_BLOCKED';
  constructor(message = '页面指引或遮罩阻挡了职位操作，已暂停；请关闭指引后继续。') {
    super(message);
  }
}

export function createOnboardingGuard(document: Document, href: string) {
  const assertClear = () => {
    if (guides(document).length || overlays(document).length) throw new OnboardingBlocked();
  };
  return {
    assertClear,
    async clear(check: () => void): Promise<void> {
      check();
      const candidates = guides(document);
      if (!candidates.length) {
        assertClear();
        return;
      }
      if (
        !supported(href) ||
        candidates.length !== 1 ||
        !safeAcknowledgement(candidates[0]) ||
        attemptedDocuments.has(document) ||
        clearingDocuments.has(document)
      )
        throw new OnboardingBlocked();
      check();
      const guide = candidates[0];
      // Recheck the exact element immediately before clicking; never click a surrounding message link.
      const latest = guides(document);
      if (
        latest.length !== 1 ||
        latest[0].root !== guide.root ||
        latest[0].acknowledgement !== guide.acknowledgement ||
        !visible(guide.acknowledgement) ||
        !safeAcknowledgement(guide) ||
        !acknowledgementIsUnobstructed(guide.acknowledgement)
      )
        throw new OnboardingBlocked();
      attemptedDocuments.add(document);
      clearingDocuments.add(document);
      try {
        guide.acknowledgement.click();
        for (let elapsed = 0; elapsed <= 1000; elapsed += 50) {
          check();
          if (!guides(document).length && !overlays(document).length) return;
          if (elapsed < 1000) await new Promise<void>((resolve) => setTimeout(resolve, 50));
        }
        throw new OnboardingBlocked('页面指引关闭后遮罩仍未消失，已暂停；请检查页面后继续。');
      } finally {
        clearingDocuments.delete(document);
      }
    },
  };
}
