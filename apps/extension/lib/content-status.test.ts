// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ listener: vi.fn() }));
vi.mock('wxt/browser', () => ({
  browser: { runtime: { id: 'synthetic-extension', onMessage: { addListener: mocks.listener } } },
}));

const sender = {
  id: 'synthetic-extension',
  url: 'chrome-extension://synthetic-extension/background.js',
};
const networkError = `<div class="jobs-split-page__content"><div class="job-list-empty">
  <p class="job-list-empty__title">网络开小差啦，请刷新重试</p><button>重试</button>
</div></div>`;
let listener: (...args: any[]) => unknown;
async function load() {
  await import('../entrypoints/content');
  listener = mocks.listener.mock.calls[0][0];
}
const send = (message: object) => new Promise<any>((resolve) => listener(message, sender, resolve));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal('defineContentScript', (config: { main: () => void }) => config.main());
  vi.stubGlobal('location', new URL('https://www.zhaopin.com/jobs/?kw=synthetic'));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  });
  document.title = '合成职位页面';
  document.body.innerHTML = networkError;
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('content recovery signals', () => {
  it('reports an explicit list network failure even without cards', async () => {
    await load();
    expect(await send({ type: 'PAGE_STATUS' })).toMatchObject({
      page: { platform: 'zhilian', kind: 'list' },
      canRead: false,
      listCount: 0,
      safeForRefresh: true,
      code: 'PAGE_NETWORK_ERROR',
      documentId: expect.any(String),
    });
  });

  it('preserves the network error code when prepare fails', async () => {
    await load();
    expect(await send({ type: 'BATCH_PREPARE', taskId: 'synthetic-task' })).toMatchObject({
      code: 'PAGE_NETWORK_ERROR',
      error: expect.stringContaining('网站职位列表加载失败'),
    });
  });

  it.each([
    ['unknown modal', '<div role="dialog">合成确认弹窗</div>'],
    ['verification', '<div class="verify-page">请完成验证</div>'],
  ])('never allows refresh over %s', async (_name, markup) => {
    document.body.insertAdjacentHTML('beforeend', markup);
    await load();
    const result = await send({ type: 'PAGE_STATUS' });
    expect(result.safeForRefresh).toBe(false);
    expect(result.code).toBeUndefined();
  });

  it('does not grant network recovery while the page is in the background', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await load();
    const result = await send({ type: 'PAGE_STATUS' });
    expect(result.safeForRefresh).toBe(false);
    expect(result.code).toBeUndefined();
  });

  it('does not mistake a loading page without a network error for a refreshable failure', async () => {
    document.body.innerHTML = '<div class="jobs-split-page__content">加载中</div>';
    await load();
    const result = await send({ type: 'PAGE_STATUS' });
    expect(result.safeForRefresh).toBe(false);
    expect(result.code).toBeUndefined();
  });
});
