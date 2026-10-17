// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessage, addListener } = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  addListener: vi.fn(),
}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      id: 'synthetic-extension',
      sendMessage,
      onMessage: { addListener },
    },
  },
}));

const base = 'http://127.0.0.1:8765';
let listeners: Array<[EventTarget, string, EventListener]> = [];
const settle = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve();
};
const offer = (request_id: string, changes = {}) =>
  new CustomEvent('easyresume:extension-offer', {
    detail: {
      request_id,
      info: JSON.stringify({
        base,
        code: '12345678901234567890',
        protocol: 1,
        expires_at: new Date(Date.now() + 60000).toISOString(),
        ...changes,
      }),
    },
  });

async function load() {
  const module = await import('../entrypoints/workbench-bridge.content');
  module.default.main({
    addEventListener(target: EventTarget, type: string, callback: EventListener) {
      target.addEventListener(type, callback);
      listeners.push([target, type, callback]);
    },
    setTimeout,
  } as never);
  await settle();
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal('location', new URL(base));
  vi.stubGlobal('defineContentScript', (config: unknown) => config);
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ name: 'EasyResume', protocol: 1 })),
      ),
  );
  sendMessage.mockReset();
  addListener.mockReset();
  sendMessage.mockImplementation(async (message: { type: string }) =>
    message.type === 'WORKBENCH_BRIDGE_STATUS' ? { needs_pairing: true } : { connected: true },
  );
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

afterEach(() => {
  for (const [target, type, callback] of listeners) target.removeEventListener(type, callback);
  listeners = [];
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('workbench page bridge boundary', () => {
  it('only transfers a matching short-lived same-origin offer', async () => {
    const request = vi.fn();
    window.addEventListener('easyresume:extension-request', request, { once: true });
    await load();
    const id = (request.mock.calls[0][0] as CustomEvent).detail.request_id;
    window.dispatchEvent(offer('unrelated-request'));
    window.dispatchEvent(offer(id, { base: 'http://127.0.0.1:8766' }));
    window.dispatchEvent(offer(id, { expires_at: new Date(Date.now() - 1).toISOString() }));
    await settle();
    expect(
      sendMessage.mock.calls.filter(([message]) => message.type === 'WORKBENCH_BRIDGE_PAIR'),
    ).toHaveLength(0);
    window.dispatchEvent(offer(id));
    await settle();
    const pairs = sendMessage.mock.calls.filter(
      ([message]) => message.type === 'WORKBENCH_BRIDGE_PAIR',
    );
    expect(pairs).toHaveLength(1);
    expect(JSON.parse(pairs[0][0].info).code).toBe('12345678901234567890');
    expect(pairs[0][0]).not.toHaveProperty('token');
    window.dispatchEvent(offer(id));
    await settle();
    expect(
      sendMessage.mock.calls.filter(([message]) => message.type === 'WORKBENCH_BRIDGE_PAIR'),
    ).toHaveLength(1);
  });

  it('does not silently replace a revoked or explicitly disconnected pairing', async () => {
    sendMessage.mockResolvedValue({ connected: false, needs_pairing: false });
    const request = vi.fn();
    window.addEventListener('easyresume:extension-request', request);
    listeners.push([window, 'easyresume:extension-request', request]);
    await load();
    await vi.advanceTimersByTimeAsync(11000);
    expect(request).not.toHaveBeenCalled();
    expect(
      sendMessage.mock.calls.every(([message]) => message.type === 'WORKBENCH_BRIDGE_STATUS'),
    ).toBe(true);
  });

  it('only allows trusted extension context to reconnect an inactive workbench tab', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await load();
    expect(sendMessage).not.toHaveBeenCalled();
    const listener = addListener.mock.calls[0][0];
    expect(
      listener(
        { type: 'WORKBENCH_RECONNECT' },
        {
          id: 'synthetic-extension',
          url: 'https://www.zhipin.com/',
        },
        vi.fn(),
      ),
    ).toBeUndefined();
    await settle();
    expect(sendMessage).not.toHaveBeenCalled();
    const requested = vi.fn();
    expect(
      listener(
        { type: 'WORKBENCH_RECONNECT' },
        {
          id: 'synthetic-extension',
          url: 'chrome-extension://synthetic-extension/background.js',
        },
        requested,
      ),
    ).toBe(true);
    await settle();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'WORKBENCH_BRIDGE_STATUS', base });
    expect(requested).toHaveBeenCalledWith({ requested: true });
  });

  it('does not lose an explicit reconnect behind an earlier connection check', async () => {
    let finish!: (value: unknown) => void;
    sendMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const request = vi.fn();
    window.addEventListener('easyresume:extension-request', request);
    listeners.push([window, 'easyresume:extension-request', request]);
    await load();
    const listener = addListener.mock.calls[0][0];
    listener(
      { type: 'WORKBENCH_RECONNECT' },
      {
        id: 'synthetic-extension',
        url: 'chrome-extension://synthetic-extension/background.js',
      },
      vi.fn(),
    );
    finish({ connected: false, needs_pairing: true });
    await settle();
    expect(
      sendMessage.mock.calls.filter(([message]) => message.type === 'WORKBENCH_BRIDGE_STATUS'),
    ).toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
