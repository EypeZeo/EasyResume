import { browser } from 'wxt/browser';
import type { Observation } from '../../lib/observe';
import './style.css';

let observations: Observation[] = [];
let connected = false;
let refreshRevision = 0;
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
  const revision = ++refreshRevision;
  connected = false;
  element('connection').textContent = '正在检查连接…';
  element<HTMLButtonElement>('read').disabled = true;
  element<HTMLButtonElement>('save').disabled = true;
  const result = await send({ type: 'STATUS' });
  if (revision !== refreshRevision) return;
  connected = result.connected;
  element('pair').hidden = result.connected;
  element('connected').hidden = !result.connected;
  element('disconnect').hidden = !result.paired;
  element<HTMLButtonElement>('read').disabled = !connected;
  element<HTMLButtonElement>('save').disabled = !connected || observations.length === 0;
  const labels: Record<string, string> = {
    connected: '已连接工作台',
    offline: '工作台未响应。请先启动 EasyResume，再点击“重新检查”。',
    expired: '连接已失效。请在工作台重新生成连接信息。',
    incompatible: '扩展与工作台版本不匹配。请更新两者后重新连接。',
    unpaired: '尚未连接。请在工作台“设置与连接 → 浏览器扩展”复制连接信息。',
  };
  element('connection').textContent = labels[result.state] ?? '连接状态未知，请重新检查';
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
      if (id === 'save') button.disabled = !connected || observations.length === 0;
    }
  };
}
action('connect', async () => {
  await send({ type: 'PAIR', info: value('connection-info') });
  element<HTMLTextAreaElement>('connection-info').value = '';
  element('status').textContent = '连接成功，可以读取当前职位页';
  await refresh();
});
action('manual-connect', async () => {
  await send({ type: 'PAIR', base: value('base'), code: value('code') });
  element<HTMLInputElement>('code').value = '';
  element('status').textContent = '只读连接已建立';
  await refresh();
});
action('disconnect', async () => {
  await send({ type: 'DISCONNECT' });
  observations = [];
  element('preview').replaceChildren();
  await refresh();
});
action('refresh', refresh);
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
  element<HTMLButtonElement>('save').disabled = !connected || observations.length === 0;
  element('status').textContent = `读取 ${observations.length} 个职位，请检查后保存。`;
});
action('save', async () => {
  const records = observations.map((o) => ({
    ...o,
    city: value('city'),
    employment_type: value('employment'),
    recruitment_type: value('recruitment'),
  }));
  try {
    const result = await send({ type: 'SAVE', observations: records });
    element('status').textContent = `已保存 ${result.saved} 个职位，请到工作台检查。`;
  } catch (error) {
    await refresh();
    throw error;
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible')
    void refresh().catch(() => {
      element('connection').textContent = '连接检查失败，请点击重新检查';
    });
});
// A side panel can stay open after the local process exits or credentials are revoked.
window.setInterval(() => {
  if (document.visibilityState === 'visible')
    void refresh().catch(() => {
      element('connection').textContent = '连接检查失败，请点击重新检查';
    });
}, 30000);
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
