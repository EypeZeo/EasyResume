// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let createOnboardingGuard: typeof import('./onboarding').createOnboardingGuard;
let OnboardingBlocked: typeof import('./onboarding').OnboardingBlocked;

const href = 'https://www.zhaopin.com/jobs/?pageMode=search&kw=Linux';
const message = '点击消息，可以直接跟招聘方聊天啦~';

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

beforeEach(async () => {
  vi.resetModules();
  ({ createOnboardingGuard, OnboardingBlocked } = await import('./onboarding'));
  vi.useFakeTimers();
  document.body.replaceChildren();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (/mask|overlay/.test(this.className)) return rect(window.innerWidth, window.innerHeight);
    return this.id === 'guide' ? rect(500, 80, 50, 50) : rect(80, 30, 60, 60);
  });
  vi.spyOn(document, 'elementFromPoint').mockImplementation(
    () => document.querySelector('#guide button, #guide [role="button"], #guide a'),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('known Zhilian onboarding acknowledgement', () => {
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
