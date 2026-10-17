import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listener: vi.fn(),
  query: vi.fn(),
  update: vi.fn(),
  sendMessage: vi.fn(),
  reconnect: vi.fn(),
  sessionGet: vi.fn(),
  sessionSet: vi.fn(),
}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { id: 'synthetic-extension', onMessage: { addListener: mocks.listener } },
    storage: {
      local: {
        setAccessLevel: async () => {},
        get: async () => ({ connection }),
        set: async () => {},
        remove: async () => {},
      },
      session: { get: mocks.sessionGet, set: mocks.sessionSet },
    },
    tabs: { query: mocks.query, update: mocks.update, sendMessage: mocks.sendMessage },
  },
}));
vi.mock('./connection', () => ({
  reconnectConnection: mocks.reconnect,
  revokeConnection: async () => true,
  pairingInfo: JSON.parse,
}));
const connection = {
  base: 'http://127.0.0.1:8765',
  token: 'synthetic-token-not-returned',
  installation: 'synthetic-installation',
};
const sender = {
  id: 'synthetic-extension',
  url: 'chrome-extension://synthetic-extension/popup.html',
};
const bridge = { id: sender.id, url: connection.base + '/', frameId: 0 };
type Tab = {
  id: number;
  url: string;
  windowId: number;
  incognito: boolean;
  active: boolean;
  title?: string;
};
let tabs: Tab[];
let listener: (...args: any[]) => unknown;
let blockedAfterNavigation: boolean;
const list = 'https://www.zhipin.com/web/geek/jobs?city=101180100&query=Linux';
const status = (href: string) => ({
  page: { platform: 'boss', kind: href.includes('/web/geek/jobs') ? 'list' : 'home' },
  entries: href.includes('/web/geek/jobs') ? [] : [{ url: list, text: '职位' }],
  canRead: href.includes('/web/geek/jobs'),
  listCount: href.includes('/web/geek/jobs') ? 3 : 0,
});
const makeTab = (id: number, url: string, active = false, extra: Partial<Tab> = {}): Tab => ({
  id,
  url,
  windowId: 7,
  incognito: false,
  active,
  ...extra,
});
const send = (message: object, source: object = sender): Promise<any> =>
  new Promise((resolve) => {
    if (listener(message, source, resolve) !== true) resolve({ ignored: true });
  });
async function load() {
  await import('../entrypoints/background');
  listener = mocks.listener.mock.calls[0][0];
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal('defineBackground', (main: () => void) => main());
  tabs = [makeTab(1, list, true)];
  blockedAfterNavigation = false;
  mocks.sessionGet.mockResolvedValue({});
  mocks.sessionSet.mockResolvedValue(undefined);
  mocks.reconnect.mockResolvedValue({ state: 'connected', connection });
  mocks.query.mockImplementation(async (query) => {
    if (query.url) return [];
    return tabs.filter((tab) => !query.active || tab.active);
  });
  mocks.update.mockImplementation(async (id: number, changes: Partial<Tab>) => {
    if (changes.active)
      tabs.forEach((tab) => {
        tab.active = tab.id === id;
      });
    const tab = tabs.find((item) => item.id === id)!;
    Object.assign(tab, changes);
    if (blockedAfterNavigation && changes.url) tab.url = 'https://www.zhipin.com/zhengzhou/';
    return tab;
  });
  mocks.sendMessage.mockImplementation(async (id, message) => {
    if (message.type === 'PAGE_STATUS') return status(tabs.find((tab) => tab.id === id)!.url);
    if (message.type === 'COLLECT_CURRENT_PAGE')
      return {
        observations: [{ title: '合成运维职位' }],
        source: { href: tabs.find((tab) => tab.id === id)!.url, platform: 'boss' },
      };
    if (message.type === 'COLLECT_SELECTION')
      return {
        observations: [{ title: '合成选区' }],
        source: { href: tabs.find((tab) => tab.id === id)!.url, platform: 'boss' },
      };
    return {};
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('recruitment navigation integration', () => {
  it('checks the real content capability before reading the active list', async () => {
    await load();
    expect(await send({ type: 'READ' })).toMatchObject({
      observations: [{ title: '合成运维职位' }],
    });
    expect(mocks.sendMessage.mock.calls.map((call) => call[1].type)).toEqual([
      'PAGE_STATUS',
      'COLLECT_CURRENT_PAGE',
    ]);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('activates one existing same-platform list instead of dispatching collection to a home page', async () => {
    tabs = [makeTab(1, 'https://www.zhipin.com/zhengzhou/', true), makeTab(2, list)];
    await load();
    expect(await send({ type: 'READ' })).toHaveProperty('observations');
    expect(mocks.update).toHaveBeenCalledWith(2, { active: true });
    expect(mocks.sendMessage.mock.calls.every((call) => call[0] === 2)).toBe(true);
  });

  it('returns explicit choices for multiple searches, then validates a user selection', async () => {
    tabs = [
      makeTab(1, 'https://www.zhipin.com/', true),
      makeTab(2, list),
      makeTab(3, list + '&salary=high'),
    ];
    await load();
    expect(await send({ type: 'READ' })).toMatchObject({
      code: 'NEEDS_SELECTION',
      choices: [{ tabId: 2 }, { tabId: 3 }],
    });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(await send({ type: 'READ', tabId: 3 })).toHaveProperty('observations');
    expect(mocks.update).toHaveBeenCalledWith(3, { active: true });
  });

  it('does not accept arbitrary tab ids from another browser window or private context', async () => {
    tabs.push(
      makeTab(2, list, false, { windowId: 8 }),
      makeTab(3, list, false, { incognito: true }),
    );
    await load();
    expect(await send({ type: 'READ', tabId: 2 })).toHaveProperty('error');
    expect(await send({ type: 'READ', tabId: 3 })).toHaveProperty('error');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('navigates one observed homepage entry and waits for its new content before reading', async () => {
    vi.useFakeTimers();
    tabs = [makeTab(1, 'https://www.zhipin.com/zhengzhou/', true)];
    await load();
    const result = send({ type: 'READ' });
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toHaveProperty('observations');
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(1, { url: list, active: true });
    expect(mocks.sendMessage.mock.calls.map((call) => call[1].type)).toEqual([
      'PAGE_STATUS',
      'PAGE_STATUS',
      'COLLECT_CURRENT_PAGE',
    ]);
  });

  it('locates one same-platform home page from the workbench and follows only its observed entry', async () => {
    vi.useFakeTimers();
    tabs = [
      makeTab(1, connection.base + '/', true),
      makeTab(2, 'https://www.zhipin.com/zhengzhou/'),
    ];
    await load();
    const result = send({ type: 'LOCATE_JOB_PAGE', platform: 'boss', purpose: 'batch' });
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toMatchObject({ located: true, tabId: 2 });
    expect(mocks.update.mock.calls).toEqual([
      [2, { active: true }],
      [2, { url: list, active: true }],
    ]);
    expect(mocks.sendMessage.mock.calls.every((call) => call[0] === 2)).toBe(true);
  });

  it('requires a choice between multiple homes and allows a chosen home only through its observed entry', async () => {
    vi.useFakeTimers();
    tabs = [
      makeTab(1, connection.base + '/', true),
      makeTab(2, 'https://www.zhipin.com/zhengzhou/'),
      makeTab(3, 'https://www.zhipin.com/beijing/'),
    ];
    await load();
    expect(await send({ type: 'READ', platform: 'boss' })).toMatchObject({
      code: 'NEEDS_SELECTION',
      choices: [{ tabId: 2 }, { tabId: 3 }],
    });
    expect(mocks.update).not.toHaveBeenCalled();
    const result = send({ type: 'READ', platform: 'boss', tabId: 3 });
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toHaveProperty('observations');
    expect(mocks.update.mock.calls).toEqual([
      [3, { active: true }],
      [3, { url: list, active: true }],
    ]);
    expect(mocks.sendMessage.mock.calls.at(-1)).toEqual([3, { type: 'COLLECT_CURRENT_PAGE' }]);
  });

  it('labels multiple home pages without exposing raw titles or tracking metadata', async () => {
    tabs = [
      makeTab(1, connection.base + '/', true),
      makeTab(2, 'https://www.zhipin.com/?token=private-token', false, {
        title: '账号张三的招聘页',
      }),
      makeTab(3, 'https://www.zhaopin.com/?session=private-session', false, {
        title: '账号李四的招聘页',
      }),
    ];
    await load();
    const result = await send({ type: 'READ' });
    expect(result).toMatchObject({
      code: 'NEEDS_SELECTION',
      choices: [
        { tabId: 2, platform: 'boss', title: 'BOSS直聘 · 首页 · 选项 1' },
        { tabId: 3, platform: 'zhilian', title: '智联招聘 · 首页 · 选项 2' },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/张三|李四|private-token|private-session|https:/);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('does not treat a selected home page as readable when it has no observed job entry', async () => {
    tabs = [
      makeTab(1, connection.base + '/', true),
      makeTab(2, 'https://www.zhipin.com/zhengzhou/'),
    ];
    mocks.sendMessage.mockResolvedValue({
      ...status('https://www.zhipin.com/'),
      entries: [],
      canRead: true,
    });
    await load();
    expect((await send({ type: 'READ', platform: 'boss', tabId: 2 })).error).toContain(
      '未找到职位入口',
    );
    expect(mocks.sendMessage.mock.calls.map((call) => call[1].type)).toEqual(['PAGE_STATUS']);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('reports a redirect back home without an automatic navigation loop', async () => {
    vi.useFakeTimers();
    tabs = [makeTab(1, 'https://www.zhipin.com/zhengzhou/', true)];
    blockedAfterNavigation = true;
    await load();
    const result = send({ type: 'READ' });
    await vi.advanceTimersByTimeAsync(12000);
    expect((await result).error).toContain('返回了首页');
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(
      mocks.sendMessage.mock.calls.some((call) => call[1].type === 'COLLECT_CURRENT_PAGE'),
    ).toBe(false);
  });

  it('rejects a stale or fabricated entry URL instead of navigating there', async () => {
    tabs = [makeTab(1, 'https://www.zhipin.com/', true)];
    await load();
    expect(
      (
        await send({
          type: 'LOCATE_JOB_PAGE',
          entryUrl: 'https://www.zhipin.com/web/geek/jobs?city=fabricated',
        })
      ).error,
    ).toContain('入口已变化');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not abandon a verification page even when a list tab exists', async () => {
    tabs = [
      makeTab(1, 'https://www.zhipin.com/web/passport/zp/security.html', true),
      makeTab(2, list),
    ];
    await load();
    expect((await send({ type: 'READ' })).error).toContain('验证');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('keeps the selected-text fallback usable when automatic detail parsing fails', async () => {
    mocks.sendMessage.mockImplementation(async (_id, message) =>
      message.type === 'PAGE_STATUS'
        ? { ...status(list), canRead: false }
        : { observations: [{ title: '合成选区' }], source: { href: list, platform: 'boss' } },
    );
    await load();
    expect(await send({ type: 'READ_SELECTION' })).toMatchObject({
      observations: [{ title: '合成选区' }],
    });
  });

  it('preserves structural diagnostics from a real content-script extraction failure', async () => {
    const diagnostics = {
      pagePath: '/web/geek/jobs',
      selectors: [{ selector: '.job-detail', count: 0 }],
      sections: [],
    };
    mocks.sendMessage.mockImplementation(async (_id, message) =>
      message.type === 'PAGE_STATUS' ? status(list) : { error: '右侧详情结构未识别', diagnostics },
    );
    await load();
    expect(await send({ type: 'READ' })).toEqual({ error: '右侧详情结构未识别', diagnostics });
  });

  it('rejects an initially selected BOSS tab that switches to Zhilian while activation completes', async () => {
    tabs = [makeTab(1, connection.base + '/', true), makeTab(7, list)];
    mocks.update.mockImplementation(async (id: number) => {
      tabs.forEach((tab) => {
        tab.active = tab.id === id;
      });
      const target = tabs.find((tab) => tab.id === id)!;
      target.url = 'https://www.zhaopin.com/jobs/?pageMode=recommend';
      return target;
    });
    await load();
    expect((await send({ type: 'READ', platform: 'boss', tabId: 7 })).error).toContain(
      '平台或列表范围已变化',
    );
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects a late COLLECT result from another platform rather than displaying it as the requested source', async () => {
    mocks.sendMessage.mockImplementation(async (_id, message) =>
      message.type === 'PAGE_STATUS'
        ? status(list)
        : {
            observations: [{ title: '另一平台职位' }],
            source: { href: 'https://www.zhaopin.com/jobs/', platform: 'zhilian' },
          },
    );
    await load();
    expect((await send({ type: 'READ', platform: 'boss' })).error).toContain(
      '平台或列表范围已变化',
    );
  });
});

describe('paired workbench command bridge', () => {
  it('allows the paired root workbench to use read-only commands without exposing credentials', async () => {
    await load();
    const result = await send(
      { type: 'WORKBENCH_BRIDGE_COMMAND', command: { type: 'READ' } },
      bridge,
    );
    expect(result).toHaveProperty('observations');
    const health = await send(
      { type: 'WORKBENCH_BRIDGE_COMMAND', command: { type: 'STATUS' } },
      bridge,
    );
    expect(health.connected).toBe(true);
    expect(JSON.stringify(health)).not.toContain(connection.token);
  });

  it.each(['PAIR', 'DISCONNECT', 'AUTO_CONNECT', 'READ_SELECTION', 'SEND', 'FETCH'])(
    'rejects non-allowlisted bridge command %s',
    async (type) => {
      await load();
      expect(
        (
          await send(
            { type: 'WORKBENCH_BRIDGE_COMMAND', command: { type, url: 'https://example.com/' } },
            bridge,
          )
        ).error,
      ).toContain('不支持');
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    },
  );

  it('rejects another loopback port and an expired paired credential', async () => {
    await load();
    const message = { type: 'WORKBENCH_BRIDGE_COMMAND', command: { type: 'READ' } };
    expect((await send(message, { ...bridge, url: 'http://127.0.0.1:8766/' })).error).toContain(
      '当前工作台',
    );
    mocks.reconnect.mockResolvedValue({ state: 'expired', connection });
    expect((await send(message, bridge)).error).toContain('连接不可用');
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('ignores recruitment-page and subframe proxies', async () => {
    await load();
    const message = { type: 'WORKBENCH_BRIDGE_COMMAND', command: { type: 'READ' } };
    expect(await send(message, { ...bridge, url: list })).toEqual({ ignored: true });
    expect(await send(message, { ...bridge, frameId: 1 })).toEqual({ ignored: true });
    expect(await send(message, { ...bridge, url: connection.base + '/other-app' })).toEqual({
      ignored: true,
    });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});

describe('paused batch page scope', () => {
  const paused = (scope: object | undefined = { platform: 'boss', href: list }) => ({
    status: 'paused',
    saved: 2,
    visited: 3,
    pages: 1,
    maxJobs: 20,
    maxPages: 2,
    autoPage: true,
    message: '已暂停',
    tabId: 7,
    taskId: 'old-task',
    installation: connection.installation,
    seen: ['old-job'],
    scope,
  });

  it.each([
    'https://www.zhaopin.com/jobs/?pageMode=recommend',
    'https://www.zhipin.com/web/geek/jobs?city=101010100&query=Linux',
    'https://www.zhipin.com/web/geek/jobs?city=101180100&query=Citrix',
  ])(
    'rejects a reused tab whose platform or search changed before BATCH_PREPARE: %s',
    async (url) => {
      tabs = [makeTab(1, connection.base + '/', true), makeTab(7, url)];
      mocks.sessionGet.mockResolvedValue({ batch: paused() });
      await load();
      expect((await send({ type: 'BATCH_RESUME' })).error).toContain('范围已变化');
      expect(mocks.sendMessage).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it('requires old tasks without an original scope to be stopped and restarted', async () => {
    tabs = [makeTab(1, connection.base + '/', true), makeTab(7, list)];
    mocks.sessionGet.mockResolvedValue({ batch: { ...paused(), scope: undefined } });
    await load();
    expect((await send({ type: 'BATCH_RESUME' })).error).toContain('缺少页面范围信息');
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('preserves counters only for the exact expected page, including a previously completed pagination step', async () => {
    const second = list + '&page=2';
    tabs = [makeTab(1, connection.base + '/', true), makeTab(7, second)];
    mocks.sessionGet.mockResolvedValue({
      batch: { ...paused({ platform: 'boss', href: second }), pages: 2 },
    });
    mocks.sendMessage.mockImplementation(async (_id, message) => {
      if (message.type === 'PAGE_STATUS') return status(second);
      if (message.type === 'BATCH_PREPARE')
        return {
          taskId: message.taskId,
          documentId: 'new-document',
          href: second,
          pageKey: 'same-scope',
          pageNumber: 1,
          completed: 0,
          targets: [],
          canNextPage: false,
        };
      return {};
    });
    await load();
    expect(await send({ type: 'BATCH_RESUME' })).toMatchObject({
      status: 'running',
      visited: 3,
      saved: 2,
      seen: ['old-job'],
      scope: { platform: 'boss', href: second },
    });
    expect(mocks.sendMessage.mock.calls.some((call) => call[1].type === 'BATCH_PREPARE')).toBe(
      true,
    );
  });

  it('persists the exact expected URL after a verified same-document pagination step', async () => {
    const second = list + '&page=2';
    mocks.sendMessage.mockImplementation(async (_id, message) => {
      if (message.type === 'PAGE_STATUS') return status(list);
      if (message.type === 'BATCH_PREPARE')
        return {
          taskId: message.taskId,
          documentId: 'document',
          href: list,
          pageKey: 'one',
          pageNumber: 1,
          completed: 0,
          targets: [],
          canNextPage: true,
        };
      if (message.type === 'BATCH_STEP')
        return {
          taskId: message.taskId,
          documentId: 'document',
          href: second,
          pageKey: 'two',
          pageNumber: 2,
          completed: 0,
          targets: [],
          canNextPage: false,
        };
      return {};
    });
    await load();
    expect(
      (await send({ type: 'BATCH_START', maxJobs: 2, maxPages: 2, autoPage: true })).status,
    ).toBe('running');
    for (let index = 0; index < 30; index++) await Promise.resolve();
    expect(await send({ type: 'BATCH_STATUS' })).toMatchObject({
      status: 'completed',
      pages: 2,
      scope: { platform: 'boss', href: second },
    });
    expect(mocks.sessionSet.mock.calls.at(-1)?.[0].batch.scope.href).toBe(second);
  });
});

describe('observed list exhaustion reporting', () => {
  it('completes a scrolling end result without counting a nonexistent page', async () => {
    const zhilian = 'https://www.zhaopin.com/jobs/?pageMode=recommend';
    tabs = [makeTab(1, zhilian, true)];
    const snapshot = {
      taskId: 'task',
      documentId: 'document',
      href: zhilian,
      pageKey: 'one',
      pageNumber: 1,
      completed: 20,
      targets: [],
      canNextPage: true,
      endOfList: false,
    };
    mocks.sendMessage.mockImplementation(async (_id, message) => {
      if (message.type === 'PAGE_STATUS')
        return {
          page: { platform: 'zhilian', kind: 'list' },
          entries: [],
          canRead: true,
          listCount: 20,
        };
      if (message.type === 'BATCH_PREPARE') return { ...snapshot, taskId: message.taskId };
      if (message.type === 'BATCH_STEP')
        return {
          ...snapshot,
          taskId: message.taskId,
          canNextPage: false,
          endOfList: true,
          done: true,
        };
      return {};
    });
    await load();
    expect(
      (await send({ type: 'BATCH_START', maxJobs: 50, maxPages: 3, autoPage: true })).status,
    ).toBe('running');
    for (let index = 0; index < 30; index++) await Promise.resolve();
    expect(await send({ type: 'BATCH_STATUS' })).toMatchObject({
      status: 'completed',
      pages: 1,
      message: '没有更多职位，本次批量读取已完成',
    });
  });
});

describe('renderer response deadlines', () => {
  it('bounds an unresponsive PAGE_STATUS and releases navigation for the next explicit attempt', async () => {
    vi.useFakeTimers();
    mocks.sendMessage.mockImplementation(() => new Promise(() => {}));
    await load();
    const started = Date.now();
    const result = send({ type: 'LOCATE_JOB_PAGE' });
    await vi.advanceTimersByTimeAsync(2000);
    expect((await result).error).toContain('响应超时');
    expect(Date.now() - started).toBeLessThanOrEqual(12000);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    mocks.sendMessage.mockResolvedValue(status(list));
    expect(await send({ type: 'LOCATE_JOB_PAGE' })).toMatchObject({ located: true, tabId: 1 });
  });

  it('preserves the last diagnostics across the total twelve-second navigation budget', async () => {
    vi.useFakeTimers();
    const diagnostics = {
      pagePath: '/web/geek/jobs',
      selectors: { '.job-detail-body > .desc': { total: 1, visible: 1 } },
    };
    mocks.sendMessage.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ...status(list),
                canRead: false,
                message: '当前职位页面布局暂未识别',
                diagnostics,
              }),
            1500,
          ),
        ),
    );
    await load();
    const started = Date.now();
    const result = send({ type: 'LOCATE_JOB_PAGE' });
    await vi.advanceTimersByTimeAsync(12000);
    expect(await result).toMatchObject({ error: expect.stringContaining('超时'), diagnostics });
    expect(Date.now() - started).toBe(12000);
    mocks.sendMessage.mockResolvedValue(status(list));
    expect(await send({ type: 'LOCATE_JOB_PAGE' })).toMatchObject({ located: true });
  });

  it('reports an unacknowledged COLLECT once and never automatically dispatches it again', async () => {
    vi.useFakeTimers();
    mocks.sendMessage.mockImplementation(async (_id, message) =>
      message.type === 'PAGE_STATUS' ? status(list) : new Promise(() => {}),
    );
    await load();
    const result = send({ type: 'READ' });
    await vi.advanceTimersByTimeAsync(5000);
    expect((await result).error).toContain('结果尚未确认');
    await vi.advanceTimersByTimeAsync(10000);
    expect(
      mocks.sendMessage.mock.calls.filter((call) => call[1].type === 'COLLECT_CURRENT_PAGE'),
    ).toHaveLength(1);
  });

  it('persists pause before waiting a bounded time for an unresponsive BATCH_STOP', async () => {
    vi.useFakeTimers();
    mocks.sessionGet.mockResolvedValue({
      batch: {
        status: 'running',
        saved: 2,
        visited: 3,
        pages: 1,
        maxJobs: 20,
        maxPages: 2,
        autoPage: true,
        message: '',
        tabId: 7,
        taskId: 'old-task',
        installation: connection.installation,
        seen: ['old-job'],
        scope: { platform: 'boss', href: list },
      },
    });
    mocks.sendMessage.mockImplementation(() => new Promise(() => {}));
    await load();
    const result = send({ type: 'BATCH_PAUSE' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toMatchObject({ status: 'paused', saved: 2, visited: 3 });
    expect(mocks.sessionSet.mock.calls.at(-1)?.[0].batch.status).toBe('paused');
  });
});
