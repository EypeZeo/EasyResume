import { browser } from 'wxt/browser';
import type { Observation } from '../../lib/observe';
import './style.css';

let observations: Observation[] = [];
let connected = false;
let refreshRevision = 0;
let readRevision = 0;
let lastState = '';
let installation = '';
let checking = false;
let noticeTimer: number | undefined;
const busy = new Set<string>();
const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const value = (id: string) => element<HTMLInputElement>(id).value;

async function send(message: object) {
  const response = await browser.runtime.sendMessage(message);
  if (!response) throw new Error('扩展后台未响应，请重新载入扩展后重试');
  if (response?.error) throw new Error(response.error);
  return response;
}
function notice(text: string, error = false, temporary = false) {
  window.clearTimeout(noticeTimer);
  const target = element('status');
  target.textContent = text;
  target.dataset.kind = error ? 'error' : 'info';
  if (temporary)
    noticeTimer = window.setTimeout(() => {
      if (target.textContent === text) target.textContent = '';
    }, 4500);
}
function buttons() {
  const active = busy.has('read') || busy.has('read-selection') || busy.has('save');
  element<HTMLButtonElement>('read').disabled = !connected || active;
  element<HTMLButtonElement>('read-selection').disabled = !connected || active;
  element<HTMLButtonElement>('save').disabled = !connected || active || observations.length === 0;
}
function clearObservations() {
  ++readRevision;
  observations = [];
  element('preview').replaceChildren();
  buttons();
}
function connectionResult(result: {
  state: string;
  connected?: boolean;
  paired?: boolean;
  installation?: string;
}) {
  const changed = result.state !== lastState;
  const identityChanged = installation !== (result.installation ?? '');
  connected = result.state === 'connected' && result.connected === true;
  if (!connected || identityChanged) clearObservations();
  const labels: Record<string, string> = {
    connected: '已连接',
    offline: '工作台离线',
    expired: '连接已失效',
    incompatible: '版本不匹配',
    unpaired: '尚未连接',
  };
  const hints: Record<string, string> = {
    connected: '',
    offline: '请启动 EasyResume。连接会每 5 秒自动检查。',
    expired: '请在工作台重新生成连接码，然后重新连接。',
    incompatible: '请更新扩展与工作台，再重新连接。',
    unpaired: '在工作台“设置与连接 → 浏览器扩展”生成并复制连接码。',
  };
  if (changed) {
    element('connection').textContent = labels[result.state] ?? '连接不可用';
    element('connection').dataset.state = result.state;
    element('connection-help').textContent = hints[result.state] ?? '请重新打开工作台检查连接。';
    if (lastState && !busy.size)
      notice(
        connected ? '工作台已重新连接' : (labels[result.state] ?? '连接状态变化'),
        false,
        true,
      );
  }
  lastState = result.state;
  installation = result.installation ?? '';
  element('pair').hidden = connected || (result.state === 'offline' && result.paired === true);
  element('connected').hidden = !connected;
  element('disconnect').hidden = !result.paired;
  buttons();
}
async function refresh(force = false) {
  if (checking && !force) return;
  const revision = ++refreshRevision;
  checking = true;
  try {
    const result = await send({ type: 'STATUS' });
    if (revision === refreshRevision) connectionResult(result);
  } catch {
    if (revision === refreshRevision)
      connectionResult({ state: 'offline', paired: !!installation, installation });
  } finally {
    if (revision === refreshRevision) checking = false;
  }
}
function action(id: string, task: () => Promise<void>) {
  element<HTMLButtonElement>(id).onclick = async () => {
    if (busy.has(id)) return;
    const button = element<HTMLButtonElement>(id);
    busy.add(id);
    button.disabled = true;
    buttons();
    try {
      await task();
    } catch (error) {
      notice(error instanceof Error ? error.message : '操作失败，请重试', true);
    } finally {
      busy.delete(id);
      button.disabled = false;
      buttons();
    }
  };
}
action('connect', async () => {
  await send({ type: 'PAIR', info: value('connection-info'), base: value('base') });
  element<HTMLInputElement>('connection-info').value = '';
  clearObservations();
  await refresh(true);
  if (connected) notice('连接成功，可以读取当前职位页', false, true);
});
action('manual-connect', async () => {
  await send({ type: 'PAIR', base: value('base'), code: value('code') });
  element<HTMLInputElement>('code').value = '';
  clearObservations();
  await refresh(true);
  if (connected) notice('连接成功，可以读取当前职位页', false, true);
});
action('disconnect', async () => {
  const result = await send({ type: 'DISCONNECT' });
  clearObservations();
  await refresh(true);
  notice(
    result.server_revoked
      ? '已断开连接'
      : '已清除本扩展的连接。工作台暂时无法确认撤销，可在工作台删除残留连接。',
    !result.server_revoked,
    result.server_revoked,
  );
});
async function readCurrent(type: 'READ' | 'READ_SELECTION') {
  clearObservations();
  const revision = readRevision;
  notice('正在读取当前页面…');
  try {
    const result = await send({ type });
    if (revision !== readRevision || !connected) return;
    if (!Array.isArray(result.observations) || result.observations.length === 0)
      throw new Error('没有读到岗位。请打开职位详情，或复制职位描述到工作台导入。');
    observations = result.observations;
    const preview = element('preview');
    for (const observation of observations) {
      const item = document.createElement('div');
      item.className = 'preview-job';
      const title = document.createElement('strong');
      title.textContent = observation.title;
      const company = document.createElement('span');
      company.textContent = observation.company || '公司待核对';
      item.append(title, company);
      preview.append(item);
    }
    buttons();
    notice(
      type === 'READ_SELECTION'
        ? '已读取选区，标题取自首行。保存后请在工作台核对岗位信息。'
        : `已读取 ${observations.length} 个岗位，检查后保存。`,
    );
  } catch (error) {
    clearObservations();
    throw error;
  }
}
action('read', () => readCurrent('READ'));
action('read-selection', () => readCurrent('READ_SELECTION'));
action('save', async () => {
  if (!connected || !observations.length) throw new Error('请先重新读取当前职位页');
  const records = observations.map((o) => ({
    ...o,
    city: value('city'),
    employment_type: value('employment'),
    recruitment_type: value('recruitment'),
  }));
  try {
    const result = await send({ type: 'SAVE', observations: records });
    clearObservations();
    notice(`已保存 ${result.saved} 个岗位，到工作台继续筛选。`);
  } catch (error) {
    await refresh(true);
    throw error;
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void refresh();
});
window.setInterval(() => {
  if (document.visibilityState === 'visible') void refresh();
}, 5000);
void refresh();

action('workbench', async () => {
  const result = await send({ type: 'STATUS' });
  await browser.tabs.create({ url: result.base ?? 'http://127.0.0.1:8765' });
});
if (document.getElementById('sidepanel'))
  action('sidepanel', async () => {
    const window = await browser.windows.getCurrent();
    if (window.id !== undefined) await browser.sidePanel.open({ windowId: window.id });
  });
