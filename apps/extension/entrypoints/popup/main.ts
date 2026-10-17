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
let currentActionId = '';
let navigationOverride: { tabId?: number; entryUrl?: string } | undefined;
type BatchStatus = {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'stopped' | 'error';
  saved: number;
  duplicates?: number;
  pendingReview?: number;
  unconfirmed?: number;
  visited: number;
  pages: number;
  maxJobs: number;
  maxPages: number;
  message?: string;
};
let batch: BatchStatus = {
  status: 'idle',
  saved: 0,
  visited: 0,
  pages: 0,
  maxJobs: 20,
  maxPages: 1,
};
const busy = new Set<string>();
const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const value = (id: string) => element<HTMLInputElement>(id).value;

async function send(message: object) {
  const navigates = ['READ', 'BATCH_START', 'LOCATE_JOB_PAGE'].includes(
    (message as { type?: string }).type ?? '',
  );
  const input = navigates && navigationOverride ? { ...message, ...navigationOverride } : message;
  if (navigates) navigationOverride = undefined;
  const response = await browser.runtime.sendMessage(input);
  if (!response) throw new Error('扩展后台未响应，请重新载入扩展后重试');
  if (response.code === 'NEEDS_SELECTION' && Array.isArray(response.choices)) {
    const retryId = currentActionId;
    const choices = element('page-choices');
    choices.replaceChildren();
    const hint = document.createElement('p');
    hint.textContent = '选择本次要读取的招聘页面：';
    choices.append(hint);
    for (const choice of response.choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = choice.title || '招聘职位';
      button.onclick = () => {
        navigationOverride =
          choice.kind === 'entry' ? { entryUrl: choice.entryUrl } : { tabId: choice.tabId };
        choices.replaceChildren();
        element<HTMLButtonElement>(retryId).click();
      };
      choices.append(button);
    }
  } else if (navigates && !response.error) element('page-choices').replaceChildren();
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
function batchActive() {
  return batch.status === 'running' || batch.status === 'paused';
}
function buttons() {
  const batchBusy = [...busy].some((key) => key.startsWith('batch-'));
  const reading =
    busy.has('read') || busy.has('read-selection') || busy.has('save') || busy.has('locate-page');
  const active = reading || batchActive() || batchBusy;
  element<HTMLButtonElement>('read').disabled = !connected || active;
  element<HTMLButtonElement>('read-selection').disabled = !connected || active;
  element<HTMLButtonElement>('locate-page').disabled = !connected || active;
  element<HTMLButtonElement>('save').disabled = !connected || active || observations.length === 0;
  element<HTMLButtonElement>('batch-start').disabled = !connected || active;
  element('batch-start').hidden = batchActive();
  element<HTMLButtonElement>('batch-pause').hidden = batch.status !== 'running';
  element<HTMLButtonElement>('batch-resume').hidden = batch.status !== 'paused';
  element<HTMLButtonElement>('batch-stop').hidden = !batchActive();
  element<HTMLButtonElement>('batch-pause').disabled = batchBusy;
  element<HTMLButtonElement>('batch-resume').disabled = !connected || batchBusy;
  element<HTMLButtonElement>('batch-stop').disabled = batchBusy;
  element<HTMLInputElement>('max-jobs').disabled = batchActive() || batchBusy;
  element<HTMLInputElement>('auto-page').disabled = batchActive() || batchBusy;
  element<HTMLInputElement>('max-pages').disabled =
    !element<HTMLInputElement>('auto-page').checked || batchActive() || batchBusy;
  element('connected').hidden = !connected && !batchActive();
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
    offline: '请启动 EasyResume，启动后会自动重连。',
    expired: '请打开工作台重新连接，也可使用新的连接码。',
    incompatible: '请更新扩展与工作台，再重新连接。',
    unpaired: '',
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
  element('pair').hidden = connected;
  element('disconnect').hidden = !result.paired;
  buttons();
}
function batchResult(result: unknown) {
  if (!result || typeof result !== 'object') return;
  const candidate = result as BatchStatus;
  if (!['idle', 'running', 'paused', 'completed', 'stopped', 'error'].includes(candidate.status))
    return;
  const previous = batch.status;
  batch = candidate;
  if (previous === 'idle' && batchActive()) selectMode('batch');
  const labels: Record<BatchStatus['status'], string> = {
    idle: '未开始',
    running: '正在读取',
    paused: '已暂停',
    completed: '读取完成',
    stopped: '已停止',
    error: '需要处理',
  };
  const count = (number: number) =>
    String(Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0);
  const updateText = (id: string, text: string) => {
    if (element(id).textContent !== text) element(id).textContent = text;
  };
  element('batch-progress').hidden = batch.status === 'idle';
  element('batch-progress').dataset.state = batch.status;
  updateText('batch-state', labels[batch.status]);
  element('batch-limit').textContent =
    `最多 ${count(batch.maxJobs)} 条 · ${count(batch.maxPages)} 页`;
  element('batch-saved').textContent = count(batch.saved);
  element('batch-visited').textContent = count(batch.visited);
  element('batch-pages').textContent = count(batch.pages);
  const outcomes = [
    batch.pendingReview ? `更新待核对 ${count(batch.pendingReview)} 条` : '',
    batch.duplicates ? `重复跳过 ${count(batch.duplicates)} 条` : '',
    batch.unconfirmed ? `保存结果待核对 ${count(batch.unconfirmed)} 条` : '',
  ].filter(Boolean);
  updateText('batch-message', [batch.message, ...outcomes].filter(Boolean).join('；'));
  buttons();
}
async function refresh(force = false) {
  if (checking && !force) return;
  const revision = ++refreshRevision;
  checking = true;
  try {
    const [connectionResponse, batchResponse] = await Promise.allSettled([
      send({ type: 'STATUS' }),
      send({ type: 'BATCH_STATUS' }),
    ]);
    if (revision !== refreshRevision) return;
    if (connectionResponse.status === 'fulfilled') connectionResult(connectionResponse.value);
    else connectionResult({ state: 'offline', paired: !!installation, installation });
    if (batchResponse.status === 'fulfilled') batchResult(batchResponse.value);
  } finally {
    if (revision === refreshRevision) checking = false;
  }
}

function selectMode(mode: 'current' | 'batch') {
  for (const name of ['current', 'batch']) {
    const selected = name === mode;
    const tab = element<HTMLButtonElement>(`${name}-tab`);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    element(`${name}-panel`).hidden = !selected;
  }
}
for (const mode of ['current', 'batch'] as const) {
  const tab = element<HTMLButtonElement>(`${mode}-tab`);
  tab.onclick = () => selectMode(mode);
  tab.onkeydown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 'current'
        : event.key === 'End'
          ? 'batch'
          : mode === 'current'
            ? 'batch'
            : 'current';
    selectMode(next);
    element<HTMLButtonElement>(`${next}-tab`).focus();
  };
}
element<HTMLInputElement>('auto-page').onchange = () => {
  element('batch-scope').textContent = element<HTMLInputElement>('auto-page').checked
    ? '到达列表末尾后使用已适配的翻页或追加加载，不超过设定页数。'
    : '仅处理当前页，不自动翻页。';
  buttons();
};

action('auto-connect', async () => {
  notice('正在查找工作台…');
  await send({ type: 'AUTO_CONNECT' });
  await refresh(true);
  notice(
    connected ? '已连接工作台' : '尚未找到工作台。请打开 EasyResume 后重试，或使用连接码。',
    false,
    connected,
  );
});
function action(id: string, task: () => Promise<void>) {
  element<HTMLButtonElement>(id).onclick = async () => {
    if (busy.has(id)) return;
    const button = element<HTMLButtonElement>(id);
    busy.add(id);
    currentActionId = id;
    button.disabled = true;
    buttons();
    try {
      await task();
    } catch (error) {
      notice(error instanceof Error ? error.message : '操作失败，请重试', true);
    } finally {
      busy.delete(id);
      if (currentActionId === id) currentActionId = '';
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
      throw new Error(
        '没有读到岗位。请先在左侧选中职位并等待右侧详情加载，或使用“读取选中的职位文字”。',
      );
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
      if (observation.text?.includes('薪资采用特殊字体')) {
        const salaryHint = document.createElement('span');
        salaryHint.className = 'preview-hint';
        salaryHint.textContent = '薪资采用特殊字体，待核对';
        item.append(salaryHint);
      }
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
action('locate-page', async () => {
  clearObservations();
  notice('正在定位招聘页面…');
  await send({
    type: 'LOCATE_JOB_PAGE',
    purpose: element('batch-panel').hidden ? 'current' : 'batch',
  });
  notice('已定位招聘页面，可以读取当前职位或开始批量读取。');
});

action('batch-start', async () => {
  const maxJobs = Number(value('max-jobs'));
  const maxPages = Number(value('max-pages'));
  const autoPage = element<HTMLInputElement>('auto-page').checked;
  if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 100)
    throw new Error('读取数量请填写 1 到 100 之间的整数');
  if (autoPage && (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 5))
    throw new Error('翻页数量请填写 1 到 5 之间的整数');
  clearObservations();
  batchResult(
    await send({ type: 'BATCH_START', maxJobs, maxPages: autoPage ? maxPages : 1, autoPage }),
  );
  await refresh(true);
});
for (const [id, type] of [
  ['batch-pause', 'BATCH_PAUSE'],
  ['batch-resume', 'BATCH_RESUME'],
  ['batch-stop', 'BATCH_STOP'],
] as const)
  action(id, async () => {
    batchResult(await send({ type }));
    await refresh(true);
  });
action('save', async () => {
  if (!connected || !observations.length) throw new Error('请先重新读取当前职位页');
  const records = observations.map((o) => ({
    ...o,
    city: value('city').trim() || o.city,
    employment_type: value('employment'),
    recruitment_type: value('recruitment'),
  }));
  try {
    const result = await send({ type: 'SAVE', observations: records });
    clearObservations();
    const saved = Number.isInteger(result.saved) && result.saved > 0 ? result.saved : 0;
    const duplicates =
      Number.isInteger(result.duplicates) && result.duplicates > 0 ? result.duplicates : 0;
    const pendingReview =
      Number.isInteger(result.pendingReview) && result.pendingReview > 0 ? result.pendingReview : 0;
    const unconfirmed =
      Number.isInteger(result.unconfirmed) && result.unconfirmed > 0 ? result.unconfirmed : 0;
    const outcomes = [
      saved ? `新增 ${saved} 个岗位待核对` : '',
      pendingReview ? `${pendingReview} 个岗位更新待核对` : '',
      duplicates ? `${duplicates} 个岗位已存在，已跳过` : '',
      unconfirmed ? `${unconfirmed} 条保存结果待核对` : '',
    ].filter(Boolean);
    notice(
      outcomes.length
        ? `${outcomes.join('；')}。请到工作台查看。`
        : '保存结果尚未确认，请到工作台检查。',
    );
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
