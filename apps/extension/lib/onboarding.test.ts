// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let createOnboardingGuard: typeof import('./onboarding').createOnboardingGuard;
let OnboardingBlocked: typeof import('./onboarding').OnboardingBlocked;

const href = 'https://www.zhaopin.com/jobs/?pageMode=search&kw=Linux';
const message = '点击消息，可以直接跟招聘方聊天啦~';
const guideAsset =
  '//fecdn5.zhaopin.cn/i_zhaopin_com/assets/im-message-entry-guide.ccccf8d1acee1a02cc42ba22fdaeb1e6.png';

function rect(width: number, height: number, left = 0, top = 0): DOMRect {
  return {
    width,
    height,
    left,
    top,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function fixture(button = '<button type="button"><span>我知道了</span></button>') {
  document.body.innerHTML = `<div class="onboarding-mask" style="position:fixed"></div>
    <div id="guide"><span>${message}</span>${button}</div>`;
  return {
    guide: document.querySelector<HTMLElement>('#guide')!,
    button: document.querySelector<HTMLElement>('#guide button, #guide [role="button"], #guide a')!,
    remove() {
      document.body.replaceChildren();
    },
  };
}

function imageFixture(src = guideAsset) {
  document.body.innerHTML = `<div class="im-message-entry-guide" style="position:absolute">
    <div class="im-message-entry-guide__mask" style="position:fixed;z-index:1000"></div>
    <img class="im-message-entry-guide__img" src="${src}" alt="" style="position:fixed;z-index:1001">
  </div>`;
  const root = document.querySelector<HTMLElement>('.im-message-entry-guide')!;
  const image = root.querySelector<HTMLImageElement>('img')!;
  Object.defineProperties(image, {
    complete: { value: true, configurable: true },
    naturalWidth: { value: 432, configurable: true },
    naturalHeight: { value: 134, configurable: true },
    currentSrc: { value: new URL(src, 'https://www.zhaopin.com/').href, configurable: true },
  });
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(rect(0, 0));
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(rect(432, 134, 200, 50));
  vi.mocked(document.elementFromPoint).mockReturnValue(image);
  return { root, image, remove: () => root.remove() };
}

beforeEach(async () => {
  vi.resetModules();
  ({ createOnboardingGuard, OnboardingBlocked } = await import('./onboarding'));
  vi.useFakeTimers();
  document.body.replaceChildren();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (/mask|overlay/.test(this.className)) return rect(window.innerWidth, window.innerHeight);
    return this.id === 'guide' ? rect(500, 80, 50, 50) : rect(80, 30, 60, 60);
  });
  vi.spyOn(document, 'elementFromPoint').mockImplementation(() =>
    document.querySelector('#guide button, #guide [role="button"], #guide a'),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('known Zhilian onboarding acknowledgement', () => {
  it('closes the observed image-only guide despite its zero-size container', async () => {
    const page = imageFixture();
    const click = vi.fn(page.remove);
    page.image.addEventListener('click', click);
    const check = vi.fn();
    const guard = createOnboardingGuard(document, href);
    expect(() => guard.assertClear()).toThrow(OnboardingBlocked);
    await guard.clear(check);
    expect(click).toHaveBeenCalledOnce();
    expect(document.elementFromPoint).toHaveBeenCalledWith(416, 117);
    expect(check.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(() => guard.assertClear()).not.toThrow();
  });

  it.each([
    '//other.example/im-message-entry-guide.ccccf8d1acee1a02cc42ba22fdaeb1e6.png',
    guideAsset.replace('ccccf8d1acee1a02cc42ba22fdaeb1e6', 'unverified-version'),
    `https://user@${guideAsset.slice(2)}`,
    `http:${guideAsset}`,
    `${guideAsset}?unknown=true`,
  ])('does not acknowledge an unverified image asset: %s', async (src) => {
    const page = imageFixture(src);
    const click = vi.fn();
    page.image.addEventListener('click', click);
    await expect(createOnboardingGuard(document, href).clear(() => undefined)).rejects.toThrow(
      OnboardingBlocked,
    );
    expect(click).not.toHaveBeenCalled();
  });

  it.each(['link', 'srcset', 'different-rendered-source', 'extra-control', 'duplicate'])(
    'does not click an ambiguous image guide with %s',
    async (change) => {
      const page = imageFixture();
      if (change === 'link') {
        const link = document.createElement('a');
        link.href = '/message';
        page.root.replaceWith(link);
        link.append(page.root);
      } else if (change === 'srcset') {
        page.image.srcset = '//other.example/prompt.png 2x';
      } else if (change === 'different-rendered-source') {
        Object.defineProperty(page.image, 'currentSrc', {
          value: 'https://other.example/prompt.png',
        });
      } else if (change === 'extra-control') {
        page.root.insertAdjacentHTML('beforeend', '<button>其他操作</button>');
      } else {
        document.body.append(page.root.cloneNode(true));
      }
      const click = vi.fn();
      page.image.addEventListener('click', click);
      await expect(createOnboardingGuard(document, href).clear(() => undefined)).rejects.toThrow(
        OnboardingBlocked,
      );
      expect(click).not.toHaveBeenCalled();
    },
  );

  it('does not click the image through another visible overlay', async () => {
    const page = imageFixture();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    vi.mocked(document.elementFromPoint).mockReturnValue(dialog);
    const click = vi.fn();
    page.image.addEventListener('click', click);
    await expect(createOnboardingGuard(document, href).clear(() => undefined)).rejects.toThrow(
      OnboardingBlocked,
    );
    expect(click).not.toHaveBeenCalled();
  });

  it('does not bubble an image click into an ancestor button linked to an external form', async () => {
    const page = imageFixture();
    const button = document.createElement('button');
    button.setAttribute('form', 'external-form');
    button.type = 'submit';
    page.root.replaceWith(button);
    button.append(page.root);
    document.body.insertAdjacentHTML('beforeend', '<form id="external-form"></form>');
    const click = vi.fn(page.remove);
    page.image.addEventListener('click', click);
    await expect(createOnboardingGuard(document, href).clear(() => undefined)).rejects.toThrow(
      OnboardingBlocked,
    );
    expect(click).not.toHaveBeenCalled();
  });

  it.each(['loading', 'broken', 'unsupported-page', 'cancelled'])(
    'does not acknowledge the image when %s',
    async (condition) => {
      const page = imageFixture();
      if (condition === 'loading') Object.defineProperty(page.image, 'complete', { value: false });
      if (condition === 'broken') Object.defineProperty(page.image, 'naturalWidth', { value: 0 });
      const click = vi.fn();
      page.image.addEventListener('click', click);
      const url = condition === 'unsupported-page' ? 'https://www.zhaopin.com/' : href;
      await expect(
        createOnboardingGuard(document, url).clear(() => {
          if (condition === 'cancelled') throw new Error('请保持招聘页面在前台');
        }),
      ).rejects.toThrow();
      expect(click).not.toHaveBeenCalled();
    },
  );

  it('does not acknowledge the image twice when a fresh guard sees it reappear', async () => {
    const page = imageFixture();
    page.image.addEventListener('click', page.remove);
    await createOnboardingGuard(document, href).clear(() => undefined);
    const repeated = imageFixture();
    const click = vi.fn();
    repeated.image.addEventListener('click', click);
    await expect(createOnboardingGuard(document, href).clear(() => undefined)).rejects.toThrow(
      OnboardingBlocked,
    );
    expect(click).not.toHaveBeenCalled();
  });

  it('closes the one exact known guide using its acknowledgement only', async () => {
    const page = fixture();
    const click = vi.fn(page.remove);
    page.button.addEventListener('click', click);
    const check = vi.fn();
    const guard = createOnboardingGuard(document, href);
    expect(() => guard.assertClear()).toThrow(OnboardingBlocked);
    await guard.clear(check);
    expect(click).toHaveBeenCalledTimes(1);
    expect(check.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(() => guard.assertClear()).not.toThrow();
  });

  it.each(['https://zhaopin.com/jobs/?pageMode=search&kw=Linux', 'https://zhaopin.com/recommend/'])(
    'handles the same known guide on the already supported bare hostname: %s',
    async (url) => {
      const page = fixture();
      const click = vi.fn(page.remove);
      page.button.addEventListener('click', click);
      const guard = createOnboardingGuard(document, url);
      await guard.clear(() => undefined);
      expect(click).toHaveBeenCalledTimes(1);
      expect(() => guard.assertClear()).not.toThrow();
    },
  );

  it('waits for delayed guide and mask removal', async () => {
    const page = fixture();
    const click = vi.fn(() => setTimeout(page.remove, 150));
    page.button.addEventListener('click', click);
    let settled = false;
    const pending = createOnboardingGuard(document, href).clear(() => undefined);
    void pending.then(() => {
      settled = true;
    });
    expect(click).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
    expect(document.querySelector('#guide')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toBeUndefined();
    expect(document.querySelector('#guide')).toBeNull();
  });

  it('accepts an unobstructed text child within the acknowledgement', async () => {
    const page = fixture();
    vi.mocked(document.elementFromPoint).mockReturnValue(page.button.querySelector('span'));
    const click = vi.fn(page.remove);
    page.button.addEventListener('click', click);
    await createOnboardingGuard(document, href).clear(() => undefined);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('checks a point within the visible portion of a partially clipped acknowledgement', async () => {
    const page = fixture();
    vi.spyOn(page.button, 'getBoundingClientRect').mockReturnValue(rect(80, 30, -20, 60));
    page.button.addEventListener('click', page.remove);
    await createOnboardingGuard(document, href).clear(() => undefined);
    expect(document.elementFromPoint).toHaveBeenCalledWith(30, 75);
  });

  it('does not retry after a guide reappears, including a newly created guard', async () => {
    const page = fixture();
    page.button.addEventListener('click', page.remove);
    await createOnboardingGuard(document, href).clear(() => undefined);
    const reappeared = fixture();
    const click = vi.fn();
    reappeared.button.addEventListener('click', click);
    await expect(createOnboardingGuard(document, href).clear(() => undefined)).rejects.toThrow(
      OnboardingBlocked,
    );
    expect(click).not.toHaveBeenCalled();
  });
});

describe('conservative blocking', () => {
  it('does not click a known acknowledgement through another overlay', async () => {
    const page = fixture();
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    other.textContent = '需要用户处理的其他弹窗';
    document.body.append(other);
    vi.mocked(document.elementFromPoint).mockReturnValue(other);
    const click = vi.fn(() => page.guide.remove());
    page.button.addEventListener('click', click);
    const pending = expect(
      createOnboardingGuard(document, href).clear(() => undefined),
    ).rejects.toThrow(OnboardingBlocked);
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    expect(click).not.toHaveBeenCalled();
  });

  it('does not consume its one attempt when the acknowledgement has no visible hit target', async () => {
    const page = fixture();
    vi.mocked(document.elementFromPoint).mockReturnValue(null);
    const click = vi.fn(page.remove);
    page.button.addEventListener('click', click);
    const guard = createOnboardingGuard(document, href);
    await expect(guard.clear(() => undefined)).rejects.toThrow(OnboardingBlocked);
    expect(click).not.toHaveBeenCalled();
    vi.mocked(document.elementFromPoint).mockReturnValue(page.button);
    await guard.clear(() => undefined);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('does not click an unrelated acknowledgement with the same name', async () => {
    const page = fixture();
    page.guide.querySelector('span')!.textContent = '其他功能的操作确认';
    const click = vi.fn();
    page.button.addEventListener('click', click);
    await expect(createOnboardingGuard(document, href).clear(() => undefined)).rejects.toThrow(
      OnboardingBlocked,
    );
    expect(click).not.toHaveBeenCalled();
  });

  it.each([
    '<a href="/message">我知道了</a>',
    '<button type="submit">我知道了</button>',
    '<form><button>我知道了</button></form>',
    '<button type="button">我知道了</button><input>',
    '<button type="button">我知道了</button><iframe></iframe>',
    '<button type="button">我知道了</button><button aria-label="其他操作"></button>',
  ])('never clicks a dangerous or ambiguous container: %s', async (markup) => {
    const page = fixture(markup);
    const click = vi.fn();
    page.guide.addEventListener('click', click);
    await expect(createOnboardingGuard(document, href).clear(() => undefined)).rejects.toThrow(
      OnboardingBlocked,
    );
    expect(click).not.toHaveBeenCalled();
  });

  it('rejects two matching guides without clicking either', async () => {
    const page = fixture();
    const clone = page.guide.cloneNode(true);
    document.body.append(clone);
    const click = vi.fn();
    document.body.addEventListener('click', click, { once: true });
    await expect(createOnboardingGuard(document, href).clear(() => undefined)).rejects.toThrow(
      OnboardingBlocked,
    );
    expect(click).not.toHaveBeenCalled();
  });

  it.each([
    'http://www.zhaopin.com/jobs/',
    'https://www.zhaopin.com/',
    'https://www.zhaopin.com.evil.example/jobs/',
    'https://jobs.zhaopin.com/example.htm',
    'https://user@www.zhaopin.com/jobs/',
    'https://www.zhaopin.com:8443/jobs/',
    'https://zhaopin.com/',
    'http://zhaopin.com/jobs/',
    'https://zhaopin.com.evil.example/jobs/',
    'https://zhaopin.com/jobs-invalid/',
    'https://zhaopin.com:8443/jobs/',
  ])('does not acknowledge on unsupported URLs: %s', async (url) => {
    const page = fixture();
    const click = vi.fn();
    page.button.addEventListener('click', click);
    await expect(createOnboardingGuard(document, url).clear(() => undefined)).rejects.toThrow(
      OnboardingBlocked,
    );
    expect(click).not.toHaveBeenCalled();
  });

  it('ignores hidden drawer masks, small overlays and normal company content', () => {
    document.body.innerHTML = `<div class="banner-drawer__mask" style="display:none;position:fixed"></div>
      <div class="company-info__intro">公司简介</div><div class="tooltip-overlay" style="position:absolute"></div>`;
    vi.spyOn(document.querySelector('.tooltip-overlay')!, 'getBoundingClientRect').mockReturnValue(
      rect(30, 30),
    );
    expect(() => createOnboardingGuard(document, href).assertClear()).not.toThrow();
  });

  it('blocks visible unknown dialogs and full-page masks', () => {
    document.body.innerHTML = '<div role="dialog">未知确认框</div>';
    expect(() => createOnboardingGuard(document, href).assertClear()).toThrow(OnboardingBlocked);
    document.body.innerHTML = '<div class="unknown-mask" style="position:fixed"></div>';
    expect(() => createOnboardingGuard(document, href).assertClear()).toThrow(OnboardingBlocked);
  });

  it('does not treat offscreen or invalid rectangles as visible masks', () => {
    document.body.innerHTML = '<div class="unknown-mask" style="position:fixed"></div>';
    const mask = document.querySelector('.unknown-mask')!;
    const bounds = vi
      .spyOn(mask, 'getBoundingClientRect')
      .mockReturnValue(rect(900, 900, -2000, -2000));
    expect(() => createOnboardingGuard(document, href).assertClear()).not.toThrow();
    bounds.mockReturnValue(rect(Number.NaN, 900));
    expect(() => createOnboardingGuard(document, href).assertClear()).not.toThrow();
  });

  it('checks cancellation before clicking', async () => {
    const page = fixture();
    const click = vi.fn();
    page.button.addEventListener('click', click);
    await expect(
      createOnboardingGuard(document, href).clear(() => {
        throw new Error('已停止');
      }),
    ).rejects.toThrow('已停止');
    expect(click).not.toHaveBeenCalled();
  });

  it('does not click an original button after the pre-click callback changes its context', async () => {
    const page = fixture();
    const click = vi.fn();
    page.button.addEventListener('click', click);
    let checks = 0;
    await expect(
      createOnboardingGuard(document, href).clear(() => {
        if (++checks === 2) page.guide.querySelector('span')!.textContent = '确认投递';
      }),
    ).rejects.toThrow(OnboardingBlocked);
    expect(click).not.toHaveBeenCalled();
  });

  it('checks cancellation while awaiting mask removal', async () => {
    const page = fixture();
    const click = vi.fn();
    page.button.addEventListener('click', click);
    let cancelled = false;
    const pending = createOnboardingGuard(document, href).clear(() => {
      if (cancelled) throw new Error('页面已切换');
    });
    const assertion = expect(pending).rejects.toThrow('页面已切换');
    cancelled = true;
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('pauses after one second if the mask remains and never clicks again', async () => {
    const page = fixture();
    const click = vi.fn(() => page.guide.remove());
    page.button.addEventListener('click', click);
    const guard = createOnboardingGuard(document, href);
    const pending = expect(guard.clear(() => undefined)).rejects.toThrow('遮罩仍未消失');
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    expect(click).toHaveBeenCalledTimes(1);
    expect(() => guard.assertClear()).toThrow(OnboardingBlocked);
  });
});
