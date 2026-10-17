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
});
async function click(text) {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent === text);
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
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
