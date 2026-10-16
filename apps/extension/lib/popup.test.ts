// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import markup from '../entrypoints/popup/index.html?raw';

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { sendMessage },
    tabs: { create: vi.fn() },
    windows: { getCurrent: vi.fn() },
    sidePanel: { open: vi.fn() },
  },
}));
const health = {
  state: 'connected',
  connected: true,
  paired: true,
  installation: 'synthetic-installation',
};
const observation = {
  title: '合成技术岗位',
  company: '合成公司',
  text: '合成说明',
  url: 'https://www.zhipin.com/job_detail/synthetic.html',
};
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
async function load() {
  await import('../entrypoints/popup/main');
  await settle();
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  sendMessage.mockReset();
  sendMessage.mockImplementation(async (message: { type: string }) =>
    message.type === 'STATUS' ? health : { observations: [observation] },
  );
  document.body.innerHTML = markup
    .match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1]
    .replace(/<script[\s\S]*?<\/script>/gi, '');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('compact extension workflow', () => {
  it('automatically checks connection every five seconds without clearing successful feedback', async () => {
    await load();
    expect(document.getElementById('connection')?.textContent).toBe('已连接');
    button('read').click();
    await settle();
    expect(button('save').disabled).toBe(false);
    const feedback = document.getElementById('status')?.textContent;
    await vi.advanceTimersByTimeAsync(5000);
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'STATUS')).toHaveLength(2);
    expect(document.getElementById('status')?.textContent).toBe(feedback);
    expect(button('save').disabled).toBe(false);
    expect(document.getElementById('advanced-fields')?.hasAttribute('open')).toBe(false);
  });
  it('clears previous observations immediately when a new read fails', async () => {
    await load();
    button('read').click();
    await settle();
    expect(document.getElementById('preview')?.textContent).toContain('合成技术岗位');
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === 'STATUS' ? health : { error: '请打开支持的职位页面' },
    );
    button('read').click();
    await settle();
    expect(document.getElementById('preview')?.textContent).toBe('');
    expect(button('save').disabled).toBe(true);
    expect(document.getElementById('status')?.textContent).toContain('请打开支持的职位页面');
  });
  it('invalidates observations when an automatic health check finds a revoked connection', async () => {
    await load();
    button('read').click();
    await settle();
    sendMessage.mockResolvedValue({
      state: 'expired',
      connected: false,
      paired: true,
      installation: health.installation,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(document.getElementById('connection')?.textContent).toBe('连接已失效');
    expect(document.getElementById('preview')?.textContent).toBe('');
    expect(button('save').disabled).toBe(true);
  });
  it('ignores a late read result after the paired installation changes', async () => {
    let finishRead: (value: unknown) => void = () => {};
    sendMessage.mockImplementation((message: { type: string }) =>
      message.type === 'STATUS'
        ? Promise.resolve(health)
        : new Promise((resolve) => {
            finishRead = resolve;
          }),
    );
    await load();
    button('read').click();
    await settle();
    sendMessage.mockResolvedValue({ ...health, installation: 'another-installation' });
    await vi.advanceTimersByTimeAsync(5000);
    finishRead({ observations: [observation] });
    await settle();
    expect(document.getElementById('preview')?.textContent).toBe('');
    expect(button('save').disabled).toBe(true);
  });
  it('explains local-only disconnection when server revocation could not be confirmed', async () => {
    await load();
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === 'DISCONNECT'
        ? { disconnected: true, server_revoked: false }
        : { state: 'unpaired', paired: false },
    );
    button('disconnect').click();
    await settle();
    expect(document.getElementById('connection')?.textContent).toBe('尚未连接');
    expect(document.getElementById('status')?.textContent).toContain('无法确认撤销');
    await vi.advanceTimersByTimeAsync(5000);
    expect(document.getElementById('status')?.textContent).toContain('无法确认撤销');
  });
});
