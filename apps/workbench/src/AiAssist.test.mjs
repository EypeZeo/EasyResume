// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError, post, request } from './api';
import { AiAssist } from './AiAssist';

vi.mock('./api', async (original) => ({ ...(await original()), post: vi.fn(), request: vi.fn() }));

let root;
let host;
const suggestion = vi.fn();
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  post.mockImplementation(async (path) =>
    path === '/ai/preview'
      ? { preview_id: 'preview', text: '合成教育经历', target: '示例服务', model: 'test' }
      : { id: 'task', status: 'waiting' },
  );
  await act(async () => {
    root.render(
      createElement(AiAssist, {
        text: '合成教育经历',
        onSuggestion: suggestion,
        onSettings: vi.fn(),
      }),
    );
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
async function click(label) {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
async function start() {
  await click('AI 辅助识别');
  await click('确认发送脱敏文本');
}

describe('AI polling terminal conditions', () => {
  it('stops polling expired tasks and returns to an explicit fresh preview', async () => {
    request.mockRejectedValue(new HttpError('任务已过期', 404));
    await start();
    expect(host.textContent).toContain('AI 任务已过期');
    expect(host.querySelector('textarea')).toBeNull();
    const calls = request.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(120000));
    expect(request.mock.calls).toHaveLength(calls);
    expect(suggestion).not.toHaveBeenCalled();
    await click('重新预览并重试 AI');
    expect(post.mock.calls.filter(([path]) => path === '/ai/preview')).toHaveLength(2);
  });
  it('retries transient errors only within the 90 second UI deadline', async () => {
    request.mockImplementation(async (_path, options) => {
      if (options?.method === 'DELETE') return {};
      throw new Error('暂时离线');
    });
    await start();
    await act(async () => vi.advanceTimersByTimeAsync(90000));
    expect(host.textContent).toContain('等待已超过 90 秒');
    expect(request.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(true);
    const calls = request.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(request.mock.calls).toHaveLength(calls);
    expect(host.querySelector('textarea')).toBeNull();
    expect(suggestion).not.toHaveBeenCalled();
  });
  it('drops a result arriving after the timeout', async () => {
    let resolveResult;
    request.mockImplementation((_path, options) =>
      options?.method === 'DELETE'
        ? Promise.resolve({})
        : new Promise((resolve) => {
            resolveResult = resolve;
          }),
    );
    await start();
    await act(async () => vi.advanceTimersByTimeAsync(90000));
    await act(async () => resolveResult({ status: 'completed', profile: {} }));
    expect(suggestion).not.toHaveBeenCalled();
    expect(host.textContent).toContain('等待已超过 90 秒');
  });
});
