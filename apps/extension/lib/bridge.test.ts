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
    expect(requested).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(12000);
    expect(requested).toHaveBeenCalledWith({ connected: false });
  });

  it('waits for the actual pair result behind an earlier connection check', async () => {
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
    const reply = vi.fn();
    listener(
      { type: 'WORKBENCH_RECONNECT' },
      {
        id: 'synthetic-extension',
        url: 'chrome-extension://synthetic-extension/background.js',
      },
      reply,
    );
    finish({ connected: false, needs_pairing: true });
    await settle();
    expect(
      sendMessage.mock.calls.filter(([message]) => message.type === 'WORKBENCH_BRIDGE_STATUS'),
    ).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(reply).not.toHaveBeenCalled();
    const id = (request.mock.calls[0][0] as CustomEvent).detail.request_id;
    window.dispatchEvent(offer(id));
    await settle();
    expect(reply).toHaveBeenCalledWith({ connected: true });
  });

  it('keeps a live offer through retry timers and reannounces it when the page is ready', async () => {
    const request = vi.fn();
    window.addEventListener('easyresume:extension-request', request);
    listeners.push([window, 'easyresume:extension-request', request]);
    await load();
    const id = (request.mock.calls[0][0] as CustomEvent).detail.request_id;
    await vi.advanceTimersByTimeAsync(3000);
    expect(request).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new CustomEvent('easyresume:workbench-ready'));
    expect(request).toHaveBeenCalledTimes(2);
    expect((request.mock.calls[1][0] as CustomEvent).detail.request_id).toBe(id);
    window.dispatchEvent(offer(id));
    await settle();
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'WORKBENCH_BRIDGE_PAIR',
      info: expect.any(String),
    });
  });
});

describe('paired workbench read-only command transport', () => {
  const issue = (type: string, payload: object = {}, request_id = crypto.randomUUID()) => {
    window.dispatchEvent(
      new CustomEvent('easyresume:browser-command', {
        detail: { request_id, type, ...payload },
      }),
    );
    return request_id;
  };
  const results = () => {
    const listener = vi.fn();
    window.addEventListener('easyresume:browser-result', listener);
    listeners.push([window, 'easyresume:browser-result', listener]);
    return listener;
  };
  const forwarded = () =>
    sendMessage.mock.calls.filter(([message]) => message.type === 'WORKBENCH_BRIDGE_COMMAND');
  const observation = {
    protocol: 1,
    url: 'https://www.zhipin.com/job_detail/synthetic.html',
    title: '合成运维岗位',
    company: '合成公司',
    text: '岗位职责：维护合成测试环境。',
    platform_job_id: 'synthetic',
    city: '合成市',
    page_kind: 'detail',
    employment_type: 'unknown',
    recruitment_type: 'unknown',
    blocked: false,
  };

  it('does not read automatically and only returns public results with the matching nonce', async () => {
    await load();
    expect(forwarded()).toHaveLength(0);
    sendMessage.mockResolvedValue({
      state: 'choose',
      code: 'NEEDS_SELECTION',
      token: 'secret-token',
      nested: {
        digest: 'secret-digest',
        proof: 'secret-proof',
        challenge: 'secret-challenge',
        authorization: 'secret-auth',
        pairing_code: 'secret-pair',
        title: '合成职位',
      },
    });
    const result = results();
    const id = issue('PAGE_STATUS', { platform: 'boss', purpose: 'current' });
    await settle();
    expect(forwarded()[0][0]).toEqual({
      type: 'WORKBENCH_BRIDGE_COMMAND',
      command: {
        type: 'PAGE_STATUS',
        platform: 'boss',
        purpose: 'current',
      },
    });
    expect((result.mock.calls[0][0] as CustomEvent).detail).toEqual({
      request_id: id,
      result: { state: 'choose', code: 'NEEDS_SELECTION', nested: { title: '合成职位' } },
    });
    expect(JSON.stringify((result.mock.calls[0][0] as CustomEvent).detail)).not.toContain(
      'secret-',
    );
  });

  it('rejects sending, pairing, connection management and arbitrary API parameters', async () => {
    await load();
    const result = results();
    for (const type of [
      'SEND',
      'PAIR',
      'DISCONNECT',
      'AUTO_CONNECT',
      'FETCH',
      'READ_SELECTION',
      'UNKNOWN',
    ])
      issue(type);
    for (const key of ['url', 'base', 'token', 'endpoint', 'headers'])
      issue('STATUS', { [key]: 'forbidden' });
    issue('PAGE_STATUS', { platform: 'untrusted' });
    issue('READ', { tabId: -1 });
    issue('BATCH_START', { maxJobs: 101 });
    issue('BATCH_START', { maxPages: 6 });
    issue('BATCH_START', { autoPage: 'true' });
    await settle();
    expect(forwarded()).toHaveLength(0);
    expect(result).toHaveBeenCalledTimes(17);
    expect(result.mock.calls.every(([event]) => !!event.detail.result.error)).toBe(true);
  });

  it('copies only observation fields and rejects unbounded or non-platform save data', async () => {
    await load();
    issue('SAVE', {
      observations: [{ ...observation, token: 'never-forward', arbitrary: 'never-forward' }],
    });
    await settle();
    expect(forwarded()[0][0].command.observations).toEqual([observation]);
    issue('SAVE', { observations: Array.from({ length: 21 }, () => observation) });
    issue('SAVE', { observations: [{ ...observation, url: 'https://example.com/api' }] });
    await settle();
    expect(forwarded()).toHaveLength(1);
  });

  it('binds one request id to one operation and does not dispatch it twice', async () => {
    await load();
    let complete!: (result: unknown) => void;
    sendMessage.mockImplementation(async (message) =>
      message.type === 'WORKBENCH_BRIDGE_COMMAND'
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : { connected: true },
    );
    const result = results();
    const id = issue('READ', { tabId: 3 });
    issue('READ', { tabId: 3 }, id);
    issue('READ', { tabId: 4 }, id);
    expect(forwarded()).toHaveLength(1);
    complete({ observations: [observation] });
    await settle();
    issue('READ', { tabId: 3 }, id);
    expect(forwarded()).toHaveLength(1);
    expect(result).toHaveBeenCalledTimes(3);
  });

  it('bounds concurrent page changes, permits stopping, and ignores late timeout replies', async () => {
    await load();
    let complete!: (result: unknown) => void;
    sendMessage.mockImplementation(async (message) =>
      message.type === 'WORKBENCH_BRIDGE_COMMAND' && message.command.type === 'READ'
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : { status: 'stopped' },
    );
    const result = results();
    const read = issue('READ');
    issue('LOCATE_JOB_PAGE');
    issue('BATCH_STOP');
    await settle();
    expect(forwarded().map(([message]) => message.command.type)).toEqual(['READ', 'BATCH_STOP']);
    await vi.advanceTimersByTimeAsync(20000);
    const before = result.mock.calls.length;
    expect(
      result.mock.calls.some(
        ([event]) => event.detail.request_id === read && !!event.detail.result.error,
      ),
    ).toBe(true);
    complete({ observations: [observation] });
    await settle();
    expect(result).toHaveBeenCalledTimes(before);
    issue('READ', {}, read);
    expect(forwarded()).toHaveLength(2);
  });

  it('limits concurrent status requests and does not exhaust capacity through normal polling', async () => {
    await load();
    const pending: Array<(value: unknown) => void> = [];
    sendMessage.mockImplementation(async (message) =>
      message.type === 'WORKBENCH_BRIDGE_COMMAND'
        ? new Promise((resolve) => pending.push(resolve))
        : { connected: true },
    );
    const result = results();
    for (let index = 0; index < 5; index++) issue('STATUS');
    expect(forwarded()).toHaveLength(4);
    expect(result.mock.calls[0][0].detail.result.error).toContain('尚未完成');
    for (const finish of pending) finish({ connected: true });
    await settle();
    sendMessage.mockResolvedValue({ connected: true });
    for (let index = 0; index < 270; index++) {
      issue('STATUS');
      await settle();
    }
    expect(forwarded()).toHaveLength(274);
    expect(result.mock.calls.filter(([event]) => event.detail.result.error)).toHaveLength(1);
  });
});
