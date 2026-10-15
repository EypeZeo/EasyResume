import { browser } from 'wxt/browser';
import type { Observation } from '../../lib/observe';
import './style.css';

let observations: Observation[] = [];
const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const value = (id: string) => element<HTMLInputElement>(id).value;
async function send(message: object) {
  const response = await browser.runtime.sendMessage(message);
  if (!response) throw new Error('扩展后台未响应，请重新载入扩展后重试');
  if (response?.error) throw new Error(response.error);
  return response;
}
async function refresh() {
  const result = await send({ type: 'STATUS' });
  element('pair').hidden = result.connected;
  element('connected').hidden = !result.connected;
  element('connection').textContent = result.connected ? `已配对 ${result.base} · 仅只读` : '';
}
function action(id: string, task: () => Promise<void>) {
  element<HTMLButtonElement>(id).onclick = async () => {
    const button = element<HTMLButtonElement>(id);
    button.disabled = true;
    try {
      await task();
    } catch (error) {
      element('status').textContent = error instanceof Error ? error.message : '操作失败';
    } finally {
      button.disabled = false;
    }
  };
}
action('connect', async () => {
  await send({ type: 'PAIR', base: value('base'), code: value('code') });
  element<HTMLInputElement>('code').value = '';
  element('status').textContent = '只读连接已建立';
  await refresh();
});
action('disconnect', async () => {
  await send({ type: 'DISCONNECT' });
  observations = [];
  await refresh();
});
action('read', async () => {
  const result = await send({ type: 'READ' });
  observations = result.observations;
  const preview = element('preview');
  preview.replaceChildren();
  for (const o of observations) {
    const p = document.createElement('p');
    p.textContent = `${o.title} · ${o.company || '公司待核对'}`;
    preview.append(p);
  }
  element<HTMLButtonElement>('save').disabled = observations.length === 0;
  element('status').textContent =
    `读取 ${observations.length} 个可见职位，请核对后保存。未保存整页或HR信息。`;
});
action('save', async () => {
  const records = observations.map((o) => ({
    ...o,
    city: value('city'),
    employment_type: value('employment'),
    recruitment_type: value('recruitment'),
  }));
  const result = await send({ type: 'SAVE', observations: records });
  element('status').textContent = `已保存 ${result.saved} 条观察。请到工作台核对关键字段。`;
});
void refresh().catch((error) => {
  element('status').textContent = error.message;
});

if (document.getElementById('workbench'))
  action('workbench', async () => {
    const result = await send({ type: 'STATUS' });
    await browser.tabs.create({ url: result.base ?? 'http://127.0.0.1:8765' });
  });
if (document.getElementById('sidepanel'))
  action('sidepanel', async () => {
    const window = await browser.windows.getCurrent();
    if (window.id) await browser.sidePanel.open({ windowId: window.id });
  });
