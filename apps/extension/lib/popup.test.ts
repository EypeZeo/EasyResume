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
const idleBatch = {
  status: 'idle',
  saved: 0,
  visited: 0,
  pages: 0,
  maxJobs: 20,
  maxPages: 1,
  message: '',
};
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
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
    message.type === 'STATUS'
      ? health
      : message.type === 'BATCH_STATUS'
        ? idleBatch
        : { observations: [observation] },
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
    expect(
      sendMessage.mock.calls.filter(([message]) => message.type === 'BATCH_STATUS'),
    ).toHaveLength(2);
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
  it('explains duplicate skips and preserves the extracted city without manual input', async () => {
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'STATUS') return health;
      if (message.type === 'BATCH_STATUS') return idleBatch;
      if (message.type === 'SAVE') return { saved: 0, duplicates: 1 };
      return { observations: [{ ...observation, city: '合成城市' }] };
    });
    await load();
    button('read').click();
    await settle();
    button('save').click();
    await settle();
    const saveMessage = sendMessage.mock.calls.find(([message]) => message.type === 'SAVE')?.[0];
    expect(saveMessage.observations[0].city).toBe('合成城市');
    expect(document.getElementById('status')?.textContent).toContain('已存在，已跳过');
    expect(document.getElementById('status')?.textContent).not.toContain('已保存 0');
    expect(button('save').disabled).toBe(true);
  });
  it.each([
    [{ pendingReview: 1, unconfirmed: 0 }, '1 个岗位更新待核对'],
    [{ pendingReview: 0, unconfirmed: 1 }, '1 条保存结果待核对'],
  ])(
    'does not announce an update or an unconfirmed save as a new job: %j',
    async (counts, text) => {
      sendMessage.mockImplementation(async (message: { type: string }) => {
        if (message.type === 'STATUS') return health;
        if (message.type === 'BATCH_STATUS') return idleBatch;
        if (message.type === 'SAVE') return { saved: 0, duplicates: 0, ...counts };
        return { observations: [observation] };
      });
      await load();
      button('read').click();
      await settle();
      button('save').click();
      await settle();
      expect(document.getElementById('status')?.textContent).toContain(text);
      expect(document.getElementById('status')?.textContent).not.toContain('新增');
      expect(document.getElementById('status')?.textContent).not.toContain('已保存');
    },
  );
  it('shows pending changes and unknown outcomes alongside batch counts', async () => {
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === 'STATUS'
        ? health
        : {
            ...idleBatch,
            status: 'completed',
            visited: 4,
            saved: 1,
            pendingReview: 1,
            duplicates: 1,
            unconfirmed: 1,
            message: '本次批量读取已完成',
          },
    );
    await load();
    expect(document.getElementById('batch-saved')?.textContent).toBe('1');
    expect(document.getElementById('batch-message')?.textContent).toContain('更新待核对 1 条');
    expect(document.getElementById('batch-message')?.textContent).toContain('重复跳过 1 条');
    expect(document.getElementById('batch-message')?.textContent).toContain('保存结果待核对 1 条');
  });
  it('shows the salary verification hint when the source uses an unreadable special font', async () => {
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === 'STATUS'
        ? health
        : message.type === 'BATCH_STATUS'
          ? idleBatch
          : { observations: [{ ...observation, text: '薪资采用特殊字体，待核对\n合成职责' }] },
    );
    await load();
    button('read').click();
    await settle();
    expect(document.querySelector('.preview-hint')?.textContent).toBe('薪资采用特殊字体，待核对');
    expect(button('save').disabled).toBe(false);
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
        : message.type === 'BATCH_STATUS'
          ? Promise.resolve(idleBatch)
          : new Promise((resolve) => {
              finishRead = resolve;
            }),
    );
    await load();
    button('read').click();
    await settle();
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === 'STATUS' ? { ...health, installation: 'another-installation' } : idleBatch,
    );
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

describe('bounded batch reading controls', () => {
  it('only starts after a user click and defaults to the current page', async () => {
    let current = { ...idleBatch };
    sendMessage.mockImplementation(
      async (message: { type: string; maxJobs?: number; maxPages?: number }) => {
        if (message.type === 'STATUS') return health;
        if (message.type === 'BATCH_START') current = { ...current, status: 'running' };
        return current;
      },
    );
    await load();
    await vi.advanceTimersByTimeAsync(5000);
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'BATCH_START')).toBe(false);
    expect(input('auto-page').checked).toBe(false);
    expect(input('max-pages').disabled).toBe(true);
    button('batch-tab').click();
    button('batch-start').click();
    await settle();
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'BATCH_START',
      maxJobs: 20,
      maxPages: 1,
      autoPage: false,
    });
    expect(button('read').disabled).toBe(true);
    expect(button('batch-pause').hidden).toBe(false);
    expect(button('batch-stop').hidden).toBe(false);
  });

  it('requires an explicit opt-in for multiple pages and validates bounded integers', async () => {
    await load();
    button('batch-tab').click();
    input('auto-page').click();
    expect(input('max-pages').disabled).toBe(false);
    input('max-jobs').value = '101';
    button('batch-start').click();
    await settle();
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'BATCH_START')).toBe(false);
    expect(document.getElementById('status')?.textContent).toContain('1 到 100');
    input('max-jobs').value = '20';
    input('max-pages').value = '1.5';
    button('batch-start').click();
    await settle();
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'BATCH_START')).toBe(false);
    input('max-pages').value = '2';
    button('batch-start').click();
    await settle();
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'BATCH_START',
      maxJobs: 20,
      maxPages: 2,
      autoPage: true,
    });
  });

  it('restores actual background progress when opened during a running task', async () => {
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === 'STATUS'
        ? health
        : {
            ...idleBatch,
            status: 'running',
            saved: 7,
            visited: 9,
            pages: 1,
            message: '正在读取第 10 条',
          },
    );
    await load();
    expect(document.getElementById('batch-panel')?.hidden).toBe(false);
    expect(button('batch-tab').getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('batch-saved')?.textContent).toBe('7');
    expect(document.getElementById('batch-message')?.textContent).toBe('正在读取第 10 条');
    expect(input('max-jobs').disabled).toBe(true);
    expect(button('save').disabled).toBe(true);
    expect(button('batch-start').hidden).toBe(true);
  });

  it('keeps stop available after a paused task loses connection, and blocks resume', async () => {
    let online = true;
    let current = { ...idleBatch, status: 'running', saved: 3 };
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'STATUS')
        return { ...health, state: online ? 'connected' : 'offline', connected: online };
      if (message.type === 'BATCH_PAUSE') current = { ...current, status: 'paused' };
      if (message.type === 'BATCH_STOP') current = { ...current, status: 'stopped' };
      return current;
    });
    await load();
    button('batch-pause').click();
    await settle();
    expect(button('batch-resume').hidden).toBe(false);
    online = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(button('batch-resume').disabled).toBe(true);
    expect(button('batch-stop').disabled).toBe(false);
    expect(document.getElementById('connected')?.hidden).toBe(false);
    button('batch-stop').click();
    await settle();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'BATCH_STOP' });
    expect(document.getElementById('batch-state')?.textContent).toBe('已停止');
  });

  it('shows background failure details without claiming a successful batch', async () => {
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === 'STATUS'
        ? health
        : {
            ...idleBatch,
            status: 'error',
            saved: 2,
            visited: 4,
            message: '页面变化，请重新选择职位后开始',
          },
    );
    await load();
    expect(document.getElementById('batch-state')?.textContent).toBe('需要处理');
    expect(document.getElementById('batch-message')?.textContent).toContain('页面变化');
    expect(document.getElementById('batch-saved')?.textContent).toBe('2');
    expect(button('batch-start').hidden).toBe(false);
    expect(button('batch-stop').hidden).toBe(true);
  });

  it('supports keyboard movement between the two reading modes', async () => {
    await load();
    button('current-tab').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    expect(button('batch-tab').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(button('batch-tab'));
    expect(document.getElementById('current-panel')?.hidden).toBe(true);
    button('batch-tab').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(button('current-tab'));
    expect(document.getElementById('current-panel')?.hidden).toBe(false);
  });
});

describe('automatic connection entry', () => {
  it('keeps a new connection code accessible when a saved workbench is offline', async () => {
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === 'STATUS' ? { state: 'offline', connected: false, paired: true } : idleBatch,
    );
    await load();
    expect(document.getElementById('pair')?.hidden).toBe(false);
    expect(document.getElementById('pair-code')).toBeTruthy();
    expect(document.getElementById('connection')?.textContent).toBe('工作台离线');
    expect(button('disconnect').hidden).toBe(false);
  });
  it('provides manual pairing as a fallback and does not claim success when discovery fails', async () => {
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === 'STATUS'
        ? { state: 'unpaired', connected: false, paired: false }
        : message.type === 'BATCH_STATUS'
          ? idleBatch
          : { found: false },
    );
    await load();
    expect(document.getElementById('pair-code')?.hasAttribute('open')).toBe(false);
    button('auto-connect').click();
    await settle();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'AUTO_CONNECT' });
    expect(document.getElementById('connection')?.textContent).toBe('尚未连接');
    expect(document.getElementById('status')?.textContent).toContain('尚未找到工作台');
    expect(document.getElementById('pair')?.hidden).toBe(false);
  });
});

describe('recruiting page location', () => {
  it('shows the batch source platform without exposing its stored URL', async () => {
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === 'STATUS'
        ? health
        : {
            ...idleBatch,
            status: 'completed',
            saved: 3,
            scope: {
              platform: 'zhilian',
              href: 'https://www.zhaopin.com/jobs/?token=private-token',
            },
          },
    );
    await load();
    expect(document.getElementById('batch-limit')?.textContent).toContain('智联招聘');
    expect(document.getElementById('batch-saved')?.textContent).toBe('3');
    expect(document.body.textContent).not.toContain('private-token');
  });

  it('marks the source unknown for older batch records rather than assuming the current site', async () => {
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === 'STATUS' ? health : { ...idleBatch, status: 'completed' },
    );
    await load();
    expect(document.getElementById('batch-limit')?.textContent).toContain('来源未记录');
  });

  it('offers explicit choices for multiple open lists and retries only the selected tab', async () => {
    sendMessage.mockImplementation(async (message: { type: string; tabId?: number }) => {
      if (message.type === 'STATUS') return health;
      if (message.type === 'BATCH_STATUS') return idleBatch;
      if (message.type === 'READ' && message.tabId !== 42)
        return {
          error: '请选择页面',
          code: 'NEEDS_SELECTION',
          choices: [{ kind: 'tab', tabId: 42, title: '合成运维职位列表' }],
        };
      return { observations: [observation] };
    });
    await load();
    button('read').click();
    await settle();
    expect(document.getElementById('page-choices')?.textContent).toContain('合成运维职位列表');
    expect(button('save').disabled).toBe(true);
    (document.querySelector('#page-choices button') as HTMLButtonElement).click();
    await settle();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'READ', tabId: 42 });
    expect(document.getElementById('page-choices')?.textContent).toBe('');
    expect(button('save').disabled).toBe(false);
  });

  it('locates a batch list without automatically starting a batch', async () => {
    await load();
    button('batch-tab').click();
    button('locate-page').click();
    await settle();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'LOCATE_JOB_PAGE', purpose: 'batch' });
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'BATCH_START')).toBe(false);
    expect(document.getElementById('status')?.textContent).toContain('已定位招聘页面');
  });
});
