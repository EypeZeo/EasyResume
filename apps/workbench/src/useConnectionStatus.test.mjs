// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { request } from './api';
import { useConnectionStatus } from './useConnectionStatus';

vi.mock('./api', () => ({ request: vi.fn() }));
let root, host, current;
const connected = { id: 'synthetic-extension', label: '合成扩展', state: 'connected' };
function Probe({ enabled = true }) {
  current = useConnectionStatus(enabled);
  return createElement(
    'div',
    null,
    createElement('output', { 'data-state': 'list' }, JSON.stringify(current.connections)),
    createElement('p', { role: 'status' }, current.notice),
  );
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.clearAllMocks();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  request.mockResolvedValue({ connections: [] });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
async function render(enabled = true) {
  await act(async () => root.render(createElement(Probe, { enabled })));
}
async function tick(milliseconds = 5000) {
  await act(async () => vi.advanceTimersByTimeAsync(milliseconds));
}

describe('visible connection status polling', () => {
  it('announces one confirmed connection transition, not each poll', async () => {
    await render();
    expect(current.notice).toBe('');
    request.mockResolvedValue({ connections: [connected] });
    await tick();
    expect(current.connections).toEqual([]);
    await tick();
    expect(current.connections).toEqual([connected]);
    expect(current.notice).toContain('已连接');
    await tick(10000);
    expect(current.notice).toBe('');
    expect(current.connections).toEqual([connected]);
  });
  it('distinguishes sleeping activity from an explicitly removed authorization', async () => {
    request.mockResolvedValue({ connections: [connected] });
    await render();
    request.mockResolvedValue({ connections: [{ ...connected, state: 'idle' }] });
    await tick();
    request.mockResolvedValue({ connections: [connected] });
    await tick();
    expect(current.connections[0].state).toBe('connected');
    expect(current.notice).toBe('');
    request.mockResolvedValue({ connections: [{ ...connected, state: 'idle' }] });
    await tick(10000);
    expect(current.notice).toBe('暂未检测到扩展活动');
    expect(current.notice).not.toContain('断开');
    request.mockResolvedValue({ connections: [] });
    await tick(10000);
    expect(current.notice).toContain('已断开');
  });
  it('pauses hidden screens and inactive settings tabs', async () => {
    await render();
    const firstCalls = request.mock.calls.length;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await tick(15000);
    expect(request.mock.calls).toHaveLength(firstCalls);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(request.mock.calls).toHaveLength(firstCalls + 1);
    await render(false);
    await tick(15000);
    expect(request.mock.calls).toHaveLength(firstCalls + 1);
  });
  it('keeps the last known list during transient failures and recovers without flicker', async () => {
    request.mockResolvedValue({ connections: [connected] });
    await render();
    request.mockRejectedValue(new Error('offline'));
    await tick();
    expect(current.serviceOffline).toBe(false);
    await tick();
    expect(current.serviceOffline).toBe(true);
    expect(current.connections).toEqual([connected]);
    request.mockResolvedValue({ connections: [connected] });
    await tick();
    expect(current.serviceOffline).toBe(false);
    expect(current.notice).toBe('工作台连接已恢复');
  });
});
