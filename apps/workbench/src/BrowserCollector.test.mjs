// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BrowserCollector from './BrowserCollector';

let root, host, commands, listener, respond, initialBatch;
const saved = vi.fn(async () => {});
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  commands = [];
  saved.mockClear();
  respond = () => ({});
  initialBatch = { status: 'idle' };
  listener = (event) => {
    commands.push(event.detail);
    window.dispatchEvent(
      new CustomEvent('easyresume:browser-result', {
        detail: {
          request_id: event.detail.request_id,
          result:
            commands.length === 1 && event.detail.type === 'BATCH_STATUS'
              ? initialBatch
              : respond(event.detail),
        },
      }),
    );
  };
  window.addEventListener('easyresume:browser-command', listener);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(BrowserCollector, { onSaved: saved })));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.removeEventListener('easyresume:browser-command', listener);
  vi.useRealTimers();
});
async function click(text) {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent === text);
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
it('keeps automatic refresh off by default and independent from auto page loading', async () => {
  await click('开始浏览器批量读取');
  expect(commands.at(-1)).toMatchObject({
    type: 'BATCH_START',
    autoPage: false,
    autoRefresh: false,
  });
  const refresh = [...host.querySelectorAll('input[type="checkbox"]')].find((input) =>
    input.parentElement.textContent.includes('加载失败时自动刷新一次并恢复'),
  );
  await act(async () => refresh.click());
  await click('开始浏览器批量读取');
  expect(commands.at(-1)).toMatchObject({
    type: 'BATCH_START',
    autoPage: false,
    autoRefresh: true,
  });
});
it('polls recovery until completion while blocking other operations and retaining pause/stop', async () => {
  vi.useFakeTimers();
  respond = () => ({ status: 'recovering', refreshes: 1, message: '正在刷新并恢复' });
  await click('检查批量任务');
  expect(host.textContent).toContain('已刷新 1 次');
  expect(host.querySelector('select').disabled).toBe(true);
  for (const input of host.querySelectorAll('input')) expect(input.disabled).toBe(true);
  for (const label of ['读取浏览器当前职位', '定位招聘页面'])
    expect(
      [...host.querySelectorAll('button')].find((button) => button.textContent === label).disabled,
    ).toBe(true);
  expect(host.textContent).not.toContain('开始浏览器批量读取');
  expect(host.textContent).toContain('暂停批量读取');
  expect(host.textContent).toContain('停止批量读取');
  respond = () => ({ status: 'completed', refreshes: 1, message: '恢复后已完成' });
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(commands.at(-1).type).toBe('BATCH_STATUS');
  expect(host.textContent).toContain('恢复后已完成');
  expect(host.querySelector('select').disabled).toBe(false);
  expect(saved).toHaveBeenCalledOnce();
});
it('saves reviewed observations without navigation-only parameters', async () => {
  respond = ({ type }) =>
    type === 'READ'
      ? { observations: [{ title: '合成岗位', company: '示例企业' }] }
      : { saved: 1, duplicates: 0 };
  await click('读取浏览器当前职位');
  expect(host.textContent).toContain('合成岗位');
  await click('保存读取的职位');
  const { request_id, ...command } = commands.at(-1);
  expect(command).toEqual({
    type: 'SAVE',
    observations: [{ title: '合成岗位', company: '示例企业' }],
  });
  expect(saved).toHaveBeenCalledOnce();
});
it('resumes the requested operation on the explicitly selected tab', async () => {
  respond = ({ tabId }) =>
    tabId === undefined
      ? {
          error: '请选择页面',
          code: 'NEEDS_SELECTION',
          choices: [{ tabId: 17, title: '示例招聘页' }],
        }
      : { observations: [{ title: '选定岗位' }] };
  await click('读取浏览器当前职位');
  await click('示例招聘页');
  expect(commands.at(-1)).toMatchObject({ type: 'READ', platform: 'boss', tabId: 17 });
  expect(host.textContent).toContain('选定岗位');
});
it('clears stale observations and shows a failed read without a save action', async () => {
  respond = () => ({ observations: [{ title: '旧岗位' }] });
  await click('读取浏览器当前职位');
  respond = () => ({ error: '当前布局未识别', diagnostics: { selectors: {} } });
  await click('读取浏览器当前职位');
  expect(host.textContent).toContain('当前布局未识别');
  expect(host.textContent).not.toContain('旧岗位');
  expect(
    [...host.querySelectorAll('button')].some((item) => item.textContent === '保存读取的职位'),
  ).toBe(false);
});
it('can locate afresh after a previously selected tab closes', async () => {
  respond = () => ({ tabId: 17, located: true });
  await click('定位招聘页面');
  respond = () => ({ error: '所选招聘页面已变化' });
  await click('读取浏览器当前职位');
  await click('定位招聘页面');
  expect(commands.at(-1)).not.toHaveProperty('tabId');
});
it('restores a paused task when the settings page is reopened', async () => {
  respond = () => ({ status: 'paused', saved: 3, visited: 4, pages: 1 });
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(createElement(BrowserCollector, { onSaved: saved })));
  expect(host.textContent).toContain('继续批量读取');
  expect(host.textContent).toContain('停止批量读取');
  expect(host.textContent).toContain('新增 3 条');
});
it('lets users inspect the extracted description without executing page markup', async () => {
  respond = () => ({
    observations: [
      { title: '合成岗位', company: '', text: '维护服务器\n<img src=x onerror=alert(1)>' },
    ],
  });
  await click('读取浏览器当前职位');
  expect(host.textContent).toContain('公司待核对');
  expect(host.querySelector('details.record-source summary').textContent).toBe(
    '查看读取的职位内容',
  );
  expect(host.querySelector('pre.source-text').textContent).toBe(
    '维护服务器\n<img src=x onerror=alert(1)>',
  );
  expect(host.querySelector('img')).toBeNull();
});
it('does not describe changed existing jobs as newly added jobs', async () => {
  respond = ({ type }) =>
    type === 'READ'
      ? { observations: [{ title: '合成岗位' }] }
      : { saved: 0, duplicates: 1, pendingReview: 2 };
  await click('读取浏览器当前职位');
  await click('保存读取的职位');
  expect(host.textContent).toContain('新增 0 个职位，跳过重复 1 个，2 个职位有变化待核对');
});
it('keeps completed batch counts attached to their actual platform when the website changes', async () => {
  respond = () => ({
    status: 'completed',
    saved: 3,
    visited: 4,
    pages: 1,
    scope: { platform: 'boss', href: 'https://www.zhipin.com/web/geek/jobs?token=private-token' },
  });
  await click('检查批量任务');
  const select = host.querySelector('select');
  await act(async () => {
    select.value = 'zhilian';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(select.value).toBe('zhilian');
  const result = host.querySelector('[data-batch-platform]');
  expect(result.dataset.batchPlatform).toBe('boss');
  expect(result.textContent).toContain('BOSS直聘 · 批量结果');
  expect(result.textContent).toContain('新增 3 条');
  expect(result.textContent).not.toContain('智联');
  expect(host.textContent).not.toContain('private-token');
});
it('does not guess the platform for an older batch result without scope', async () => {
  respond = () => ({ status: 'stopped', saved: 2, visited: 2, pages: 1 });
  await click('检查批量任务');
  expect(host.querySelector('[data-batch-platform]').textContent).toContain(
    '来源未记录 · 批量结果',
  );
});
it('renders distinct safe tab labels and retries the chosen page only', async () => {
  respond = ({ tabId }) =>
    tabId === undefined
      ? {
          code: 'NEEDS_SELECTION',
          error: '请选择页面',
          choices: [
            { tabId: 17, title: '智联招聘 · 推荐职位' },
            { tabId: 18, title: '智联招聘 · 搜索职位 · Linux · 郑州' },
          ],
        }
      : { observations: [{ title: '合成岗位' }] };
  await click('读取浏览器当前职位');
  await click('智联招聘 · 搜索职位 · Linux · 郑州');
  expect(commands.at(-1)).toMatchObject({ type: 'READ', tabId: 18 });
});
