import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listener: vi.fn(),
  query: vi.fn(),
  reload: vi.fn(),
  sendMessage: vi.fn(),
  localGet: vi.fn(),
  localSet: vi.fn(),
  sessionGet: vi.fn(),
  sessionSet: vi.fn(),
  reconnect: vi.fn(),
}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { id: 'test-extension', onMessage: { addListener: mocks.listener } },
    storage: {
      local: {
        setAccessLevel: async () => {},
        get: mocks.localGet,
        set: mocks.localSet,
        remove: async () => {},
      },
      session: { get: mocks.sessionGet, set: mocks.sessionSet },
    },
    tabs: { query: mocks.query, reload: mocks.reload, sendMessage: mocks.sendMessage },
  },
}));
vi.mock('./connection', () => ({
  reconnectConnection: mocks.reconnect,
  revokeConnection: async () => true,
  pairingInfo: JSON.parse,
}));

const href = 'https://www.zhipin.com/web/geek/jobs?city=101180100&query=Linux';
const connection = {
  base: 'http://127.0.0.1:8765',
  token: 'test-token',
  installation: 'test-installation',
};
const target = (id: string) => ({
  key: `https://www.zhipin.com/job_detail/${id}.html`,
  platform_job_id: id,
  title: id,
  company: '合成公司',
});
const queue = [target('first'), target('second')];
let data: Record<string, any>;
let batch: any;
let tab: any;
let reloaded: boolean;
let freshQueue: typeof queue;
let withIds: boolean;
let safe: boolean;
let settled: boolean;
let sameDocument: boolean;
let failureCode: string | undefined;
let failNew: boolean;
let saveFails: boolean;
let listener: (...args: any[]) => unknown;

const snapshot = (taskId: string, old = !reloaded) => ({
  taskId,
  documentId: old || sameDocument ? 'old-document' : 'new-document',
  href,
  pageKey: old ? 'old-list' : 'new-list',
  pageNumber: 1,
  completed: 0,
  targets: (old ? queue : freshQueue).map((value) => ({
    ...value,
    platform_job_id: withIds ? value.platform_job_id : '',
  })),
  canNextPage: false,
  canLoadMore: false,
});
const send = (message: object): Promise<any> =>
  new Promise((resolve) => {
    if (
      listener(
        message,
        { id: 'test-extension', url: 'chrome-extension://test-extension/popup.html' },
        resolve,
      ) !== true
    )
      resolve({ ignored: true });
  });
async function load() {
  await import('../entrypoints/background');
  listener = mocks.listener.mock.calls[0][0];
}
async function run(autoRefresh = true, options = {}) {
  await load();
  const started = await send({ type: 'BATCH_START', maxJobs: 3, autoRefresh, ...options });
  expect(started.status).toBe('running');
  await vi.advanceTimersByTimeAsync(50000);
  return send({ type: 'BATCH_STATUS' });
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(1000000);
  vi.stubGlobal('defineBackground', (main: () => void) => main());
  data = { connection };
  batch = undefined;
  tab = { id: 7, url: href, windowId: 3, incognito: false, active: true };
  reloaded = false;
  freshQueue = [...queue];
  withIds = true;
  safe = true;
  settled = true;
  sameDocument = false;
  failureCode = 'DETAIL_LOAD_TIMEOUT';
  failNew = false;
  saveFails = false;
  mocks.localGet.mockImplementation(async () => structuredClone(data));
  mocks.localSet.mockImplementation(async (changes) =>
    Object.assign(data, structuredClone(changes)),
  );
  mocks.sessionGet.mockImplementation(async () => ({ batch }));
  mocks.sessionSet.mockImplementation(async (changes) => {
    batch = structuredClone(changes.batch);
  });
  mocks.reconnect.mockImplementation(async () => ({
    state: 'connected',
    connection: data.connection,
  }));
  mocks.query.mockImplementation(async (query) => (query.url ? [] : [structuredClone(tab)]));
  mocks.reload.mockImplementation(async () => {
    reloaded = true;
  });
  mocks.sendMessage.mockImplementation(async (_id, message) => {
    if (message.type === 'PAGE_STATUS')
      return {
        page: { platform: 'boss', kind: 'list' },
        entries: [],
        canRead: true,
        listCount: 2,
        documentId: reloaded && !sameDocument ? 'new-document' : 'old-document',
        safeForRefresh: safe,
      };
    if (message.type === 'BATCH_PREPARE') return snapshot(message.taskId);
    if (message.type === 'BATCH_STOP')
      return {
        stopped: true,
        settled,
        taskId: message.taskId,
        documentId: reloaded ? 'new-document' : 'old-document',
      };
    if (message.type === 'BATCH_STEP') {
      if (message.targetKey === queue[1].key && (!reloaded || failNew))
        return { error: '详情加载超时', code: failureCode };
      const item = queue.find((value) => value.key === message.targetKey)!;
      return {
        ...snapshot(message.taskId),
        observation: {
          title: item.title,
          company: item.company,
          url: item.key,
          platform_job_id: item.platform_job_id,
        },
      };
    }
    throw new Error('Unexpected command');
  });
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(async () =>
        saveFails
          ? new Response('{"detail":"保存异常"}', { status: 503 })
          : new Response('{"status":"awaiting_review"}'),
      ),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('bounded automatic batch refresh', () => {
  it('restores a new document and task, preserving completed jobs and totals', async () => {
    const result = await run();
    expect(result, result.message).toMatchObject({
      status: 'completed',
      refreshes: 1,
      visited: 2,
      saved: 2,
    });
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    const preparations = mocks.sendMessage.mock.calls.filter(
      (call) => call[1].type === 'BATCH_PREPARE',
    );
    expect(preparations).toHaveLength(2);
    expect(preparations[0][1].taskId).not.toBe(preparations[1][1].taskId);
    expect(data.lastAutoRefreshAt).toBe(1000000);
  });
  it('restores the full identified queue even when only one remaining read is allowed', async () => {
    expect(await run(true, { maxJobs: 2 })).toMatchObject({
      status: 'completed',
      visited: 2,
      saved: 2,
      refreshes: 1,
    });
    const preparations = mocks.sendMessage.mock.calls.filter(
      (call) => call[1].type === 'BATCH_PREPARE',
    );
    expect(preparations[1][1].options.maxItems).toBe(1);
    expect(
      vi.mocked(fetch).mock.calls.map((call) => JSON.parse(String(call[1]?.body)).platform_job_id),
    ).toEqual(['first', 'second']);
  });
  it('allows guarded preparation to clear a recognized guide after reloading', async () => {
    const original = mocks.sendMessage.getMockImplementation()!;
    let guideCleared = false;
    mocks.sendMessage.mockImplementation(async (id, message) => {
      const result = await original(id, message);
      if (reloaded && message.type === 'PAGE_STATUS' && !guideCleared)
        return { ...result, safeForRefresh: false, message: '页面指引或遮罩阻挡了职位操作' };
      if (reloaded && message.type === 'BATCH_PREPARE') guideCleared = true;
      return result;
    });
    expect(await run()).toMatchObject({ status: 'completed', saved: 2, refreshes: 1 });
    expect(guideCleared).toBe(true);
  });
  it.each(['未知遮罩', '安全验证'])(
    'pauses when guarded preparation rejects %s after reloading',
    async (reason) => {
      const original = mocks.sendMessage.getMockImplementation()!;
      mocks.sendMessage.mockImplementation(async (id, message) => {
        const result = await original(id, message);
        if (reloaded && message.type === 'PAGE_STATUS')
          return { ...result, safeForRefresh: false, message: reason };
        if (reloaded && message.type === 'BATCH_PREPARE') return { error: reason };
        return result;
      });
      const result = await run();
      expect(result).toMatchObject({ status: 'paused', saved: 1, refreshes: 1 });
      expect(result.message).toContain(reason);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it('still requires a safe page after preparation reports success', async () => {
    const original = mocks.sendMessage.getMockImplementation()!;
    mocks.sendMessage.mockImplementation(async (id, message) => {
      const result = await original(id, message);
      return reloaded && message.type === 'PAGE_STATUS'
        ? { ...result, safeForRefresh: false }
        : result;
    });
    expect(await run()).toMatchObject({ status: 'paused', saved: 1, refreshes: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not refresh without explicit opt-in', async () => {
    expect(await run(false)).toMatchObject({ status: 'paused', visited: 1 });
    expect(mocks.reload).not.toHaveBeenCalled();
  });
  it('does not recover a generic response timeout or other failure', async () => {
    failureCode = undefined;
    expect(await run()).toMatchObject({ status: 'paused', visited: 1 });
    expect(mocks.reload).not.toHaveBeenCalled();
  });
  it('does not refresh a save failure', async () => {
    saveFails = true;
    expect(await run()).toMatchObject({ status: 'paused', visited: 0 });
    expect(mocks.reload).not.toHaveBeenCalled();
  });
  it('rechecks a fresh list from the beginning without reusing anonymous card keys', async () => {
    withIds = false;
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      const value = JSON.parse(String(init?.body));
      return new Response(
        reloaded && value.platform_job_id === 'first'
          ? '{"duplicate":true}'
          : '{"status":"awaiting_review"}',
      );
    });
    expect(await run()).toMatchObject({
      status: 'completed',
      refreshes: 1,
      visited: 3,
      saved: 2,
      duplicates: 1,
      maxJobs: 3,
    });
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(fetch).mock.calls.map((call) => JSON.parse(String(call[1]?.body)).platform_job_id),
    ).toEqual(['first', 'first', 'second']);
    const preparations = mocks.sendMessage.mock.calls.filter(
      (call) => call[1].type === 'BATCH_PREPARE',
    );
    expect(preparations[1][1].options.maxItems).toBe(2);
  });
  it('can refresh once for an explicit site network error without treating it as the list end', async () => {
    failureCode = 'PAGE_NETWORK_ERROR';
    expect(await run()).toMatchObject({
      status: 'completed',
      refreshes: 1,
      visited: 2,
      saved: 2,
    });
    expect(mocks.reload).toHaveBeenCalledTimes(1);
  });
  it('does not carry anonymous seen keys onto a reordered fresh list', async () => {
    withIds = false;
    freshQueue = [...queue].reverse();
    expect(await run()).toMatchObject({ status: 'completed', visited: 3, refreshes: 1 });
    expect(
      vi.mocked(fetch).mock.calls.map((call) => JSON.parse(String(call[1]?.body)).platform_job_id),
    ).toEqual(['first', 'second', 'first']);
  });
  it('counts repeated reads against the original quantity limit after a fresh scan', async () => {
    withIds = false;
    expect(await run(true, { maxJobs: 2 })).toMatchObject({
      status: 'completed',
      visited: 2,
      maxJobs: 2,
      refreshes: 1,
    });
    expect(
      vi.mocked(fetch).mock.calls.map((call) => JSON.parse(String(call[1]?.body)).platform_job_id),
    ).toEqual(['first', 'first']);
  });
  it('refreshes an explicit initial network error before any batch reader could prepare', async () => {
    const original = mocks.sendMessage.getMockImplementation()!;
    mocks.sendMessage.mockImplementation(async (id, message) => {
      const result = await original(id, message);
      if (!reloaded && message.type === 'PAGE_STATUS')
        return { ...result, code: 'PAGE_NETWORK_ERROR', listCount: 0, canRead: false };
      if (!reloaded && message.type === 'BATCH_STOP') return { ...result, stopped: false };
      if (!reloaded && message.type === 'BATCH_PREPARE')
        throw new Error('The initial failed list must not be prepared');
      return result;
    });
    expect(await run()).toMatchObject({
      status: 'completed',
      refreshes: 1,
      visited: 2,
      saved: 2,
    });
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    expect(
      mocks.sendMessage.mock.calls.filter((call) => call[1].type === 'BATCH_PREPARE'),
    ).toHaveLength(1);
  });
  it('recovers a network error that appears between locating the list and preparation', async () => {
    const original = mocks.sendMessage.getMockImplementation()!;
    let prepareFailed = false;
    mocks.sendMessage.mockImplementation(async (id, message) => {
      const result = await original(id, message);
      if (!reloaded && message.type === 'BATCH_PREPARE') {
        prepareFailed = true;
        return { error: '网站列表网络错误', code: 'PAGE_NETWORK_ERROR' };
      }
      if (!reloaded && prepareFailed && message.type === 'PAGE_STATUS')
        return { ...result, code: 'PAGE_NETWORK_ERROR', listCount: 0, canRead: false };
      if (!reloaded && message.type === 'BATCH_STOP') return { ...result, stopped: false };
      return result;
    });
    expect(await run()).toMatchObject({ status: 'completed', refreshes: 1, visited: 2 });
  });
  it('requires the initial failed page to acknowledge that no step is in flight', async () => {
    const original = mocks.sendMessage.getMockImplementation()!;
    mocks.sendMessage.mockImplementation(async (id, message) => {
      const result = await original(id, message);
      if (!reloaded && message.type === 'PAGE_STATUS')
        return { ...result, code: 'PAGE_NETWORK_ERROR', listCount: 0 };
      if (!reloaded && message.type === 'BATCH_STOP')
        return { ...result, stopped: false, settled: false };
      return result;
    });
    expect(await run()).toMatchObject({ status: 'paused', visited: 0, refreshes: 0 });
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not opt in to refreshing an initial network error by default', async () => {
    const original = mocks.sendMessage.getMockImplementation()!;
    mocks.sendMessage.mockImplementation(async (id, message) => {
      const result = await original(id, message);
      return message.type === 'PAGE_STATUS'
        ? { ...result, code: 'PAGE_NETWORK_ERROR', listCount: 0, message: '网站网络错误' }
        : result;
    });
    await load();
    const start = send({ type: 'BATCH_START', maxJobs: 3, autoRefresh: false });
    await vi.advanceTimersByTimeAsync(20000);
    expect(await start).toMatchObject({ error: expect.stringContaining('网站网络错误') });
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cannot use the initial-only empty-stop exception after already saving a job', async () => {
    const original = mocks.sendMessage.getMockImplementation()!;
    mocks.sendMessage.mockImplementation(async (id, message) => {
      const result = await original(id, message);
      return message.type === 'BATCH_STOP' ? { ...result, stopped: false } : result;
    });
    expect(await run()).toMatchObject({ status: 'paused', visited: 1, refreshes: 0 });
    expect(mocks.reload).not.toHaveBeenCalled();
  });
  it('does not turn an uncertain preparation timeout into an initial network recovery', async () => {
    const original = mocks.sendMessage.getMockImplementation()!;
    let releasePreparation: (() => void) | undefined;
    mocks.sendMessage.mockImplementation(async (id, message) => {
      const result = await original(id, message);
      if (message.type === 'BATCH_PREPARE')
        await new Promise<void>((resolve) => {
          releasePreparation = resolve;
        });
      return result;
    });
    await load();
    const start = send({ type: 'BATCH_START', maxJobs: 3, autoRefresh: true });
    await vi.advanceTimersByTimeAsync(6000);
    expect(await start).toMatchObject({ error: expect.stringContaining('响应超时') });
    releasePreparation!();
    await vi.advanceTimersByTimeAsync(20000);
    expect(await send({ type: 'BATCH_STATUS' })).toMatchObject({ status: 'idle', visited: 0 });
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['BATCH_PAUSE', 'BATCH_STOP', 'DISCONNECT'])(
    'honors %s during the initial network-error reload wait',
    async (type) => {
      const original = mocks.sendMessage.getMockImplementation()!;
      mocks.sendMessage.mockImplementation(async (id, message) => {
        const result = await original(id, message);
        if (!reloaded && message.type === 'PAGE_STATUS')
          return { ...result, code: 'PAGE_NETWORK_ERROR', listCount: 0 };
        if (!reloaded && message.type === 'BATCH_STOP') return { ...result, stopped: false };
        return result;
      });
      await load();
      await send({ type: 'BATCH_START', maxJobs: 3, autoRefresh: true });
      await vi.advanceTimersByTimeAsync(0);
      expect((await send({ type: 'BATCH_STATUS' })).status).toBe('recovering');
      await send({ type });
      await vi.advanceTimersByTimeAsync(20000);
      expect(await send({ type: 'BATCH_STATUS' })).toMatchObject({
        status: type === 'BATCH_PAUSE' ? 'paused' : 'stopped',
        visited: 0,
        saved: 0,
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('keeps the remaining page budget when rechecking anonymous cards after a refresh', async () => {
    withIds = false;
    const original = mocks.sendMessage.getMockImplementation()!;
    mocks.sendMessage.mockImplementation(async (id, message) => {
      const result = await original(id, message);
      if (!reloaded && result.targets)
        return { ...result, pageNumber: 2, canNextPage: true, canLoadMore: true };
      return result;
    });
    expect(await run(true, { autoPage: true, maxPages: 2 })).toMatchObject({
      status: 'completed',
      pages: 2,
      maxPages: 2,
      visited: 3,
    });
    const preparations = mocks.sendMessage.mock.calls.filter(
      (call) => call[1].type === 'BATCH_PREPARE',
    );
    expect(preparations[1][1].options.maxPages).toBe(1);
  });
  it('requires an explicit settled acknowledgement before reloading', async () => {
    settled = false;
    expect((await run()).message).toContain('尚未确认停止');
    expect(mocks.reload).not.toHaveBeenCalled();
  });
  it('does not refresh a page reporting an unsafe state', async () => {
    safe = false;
    expect((await run()).message).toContain('不适合安全刷新');
    expect(mocks.reload).not.toHaveBeenCalled();
  });
  it.each(['reorder', 'replace', 'append'])(
    'pauses on a changed %s queue without saving its detail',
    async (kind) => {
      freshQueue =
        kind === 'reorder'
          ? [...queue].reverse()
          : kind === 'append'
            ? [...queue, target('third')]
            : [queue[0], target('replacement')];
      expect(await run()).toMatchObject({ status: 'paused', saved: 1, visited: 1, refreshes: 1 });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it('does not treat an old content script as a completed reload', async () => {
    sameDocument = true;
    expect((await run()).message).toContain('等待职位列表超时');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('persists the five-minute budget across tasks', async () => {
    data.lastAutoRefreshAt = Date.now() - 299999;
    expect((await run()).message).toContain('不足五分钟');
    expect(mocks.reload).not.toHaveBeenCalled();
  });
  it('does not reload twice when the fresh document also times out', async () => {
    failNew = true;
    expect(await run()).toMatchObject({ status: 'paused', refreshes: 1, visited: 1 });
    expect(mocks.reload).toHaveBeenCalledTimes(1);
  });
  it('does not resume a persisted recovering task after a worker restart', async () => {
    batch = { status: 'recovering', refreshes: 1, saved: 1, visited: 1, seen: [queue[0].key] };
    await load();
    expect(await send({ type: 'BATCH_STATUS' })).toMatchObject({ status: 'paused', refreshes: 1 });
    expect(mocks.reload).not.toHaveBeenCalled();
  });
  it('does not reuse seen keys after a manual reload when the URL is unchanged', async () => {
    await run(false);
    reloaded = true;
    const result = await send({ type: 'BATCH_RESUME' });
    expect(result.error).toContain('网页已刷新');
    expect(await send({ type: 'BATCH_STATUS' })).toMatchObject({
      status: 'paused',
      documentId: 'old-document',
      saved: 1,
      visited: 1,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('requires an old paused task without a document identity to restart', async () => {
    await run(false);
    delete batch.documentId;
    vi.resetModules();
    mocks.listener.mockClear();
    await load();
    expect((await send({ type: 'BATCH_RESUME' })).error).toContain('缺少原网页标识');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['documentId', 'taskId'])(
    'rejects a step with a mismatched %s before saving',
    async (field) => {
      const original = mocks.sendMessage.getMockImplementation()!;
      mocks.sendMessage.mockImplementation(async (id, message) => {
        const result = await original(id, message);
        return message.type === 'BATCH_STEP' && result.observation
          ? { ...result, [field]: 'unrelated-context' }
          : result;
      });
      expect(await run()).toMatchObject({ status: 'paused', visited: 0, saved: 0 });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('cancels a pending reload wait without a late restart', async () => {
    await load();
    await send({ type: 'BATCH_START', maxJobs: 3, autoRefresh: true });
    await vi.advanceTimersByTimeAsync(0);
    expect((await send({ type: 'BATCH_STATUS' })).status).toBe('recovering');
    await send({ type: 'BATCH_STOP' });
    await vi.advanceTimersByTimeAsync(20000);
    expect(await send({ type: 'BATCH_STATUS' })).toMatchObject({ status: 'stopped', visited: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['BATCH_PAUSE', 'DISCONNECT'])(
    'does not overwrite %s while the final recovery context query is pending',
    async (type) => {
      const original = mocks.sendMessage.getMockImplementation()!;
      let freshStatusChecks = 0;
      mocks.sendMessage.mockImplementation(async (id, message) => {
        const result = await original(id, message);
        if (reloaded && message.type === 'PAGE_STATUS') freshStatusChecks++;
        return result;
      });
      let releaseQuery: (() => void) | undefined;
      mocks.query.mockImplementation(async (query) => {
        const result = query.url ? [] : [structuredClone(tab)];
        if (query.active && freshStatusChecks === 2 && !releaseQuery)
          await new Promise<void>((resolve) => {
            releaseQuery = resolve;
          });
        return result;
      });
      await load();
      await send({ type: 'BATCH_START', maxJobs: 3, autoRefresh: true });
      await vi.advanceTimersByTimeAsync(1000);
      expect(releaseQuery).toBeTypeOf('function');
      await send({ type });
      releaseQuery!();
      await vi.advanceTimersByTimeAsync(20000);
      expect(await send({ type: 'BATCH_STATUS' })).toMatchObject({
        status: type === 'DISCONNECT' ? 'stopped' : 'paused',
        visited: 1,
        saved: 1,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['url', 'window', 'incognito', 'active'])(
    'does not continue when the %s context changes during reload',
    async (kind) => {
      mocks.reload.mockImplementation(async () => {
        reloaded = true;
        if (kind === 'url') tab.url = 'https://www.zhipin.com/zhengzhou/';
        if (kind === 'window') tab.windowId = 99;
        if (kind === 'incognito') tab.incognito = true;
        if (kind === 'active') tab.id = 99;
      });
      expect(await run()).toMatchObject({ status: 'paused', visited: 1 });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it('waits for a new document list to appear before restoring', async () => {
    const original = mocks.sendMessage.getMockImplementation()!;
    let loadingChecks = 0;
    mocks.sendMessage.mockImplementation(async (id, message) => {
      const result = await original(id, message);
      if (reloaded && message.type === 'PAGE_STATUS' && loadingChecks++ < 2)
        return { ...result, listCount: 0, safeForRefresh: false };
      return result;
    });
    expect(await run()).toMatchObject({ status: 'completed', saved: 2 });
    expect(loadingChecks).toBeGreaterThanOrEqual(3);
  });
  it('waits for a slow site beyond fifteen seconds without refreshing twice', async () => {
    const original = mocks.sendMessage.getMockImplementation()!;
    mocks.sendMessage.mockImplementation(async (id, message) => {
      const result = await original(id, message);
      return reloaded && message.type === 'PAGE_STATUS' && Date.now() < 1020000
        ? { ...result, listCount: 0, safeForRefresh: false }
        : result;
    });
    await load();
    await send({ type: 'BATCH_START', maxJobs: 3, autoRefresh: true });
    await vi.advanceTimersByTimeAsync(16000);
    expect(await send({ type: 'BATCH_STATUS' })).toMatchObject({
      status: 'recovering',
      message: expect.stringContaining('最长45秒'),
      visited: 1,
      refreshes: 1,
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(await send({ type: 'BATCH_STATUS' })).toMatchObject({
      status: 'completed',
      visited: 2,
      saved: 2,
    });
    expect(mocks.reload).toHaveBeenCalledTimes(1);
  });
  it('pauses immediately when the fresh document explicitly reports another network error', async () => {
    const original = mocks.sendMessage.getMockImplementation()!;
    mocks.sendMessage.mockImplementation(async (id, message) => {
      const result = await original(id, message);
      return reloaded && message.type === 'PAGE_STATUS'
        ? { ...result, code: 'PAGE_NETWORK_ERROR', listCount: 0 }
        : result;
    });
    await load();
    await send({ type: 'BATCH_START', maxJobs: 3, autoRefresh: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await send({ type: 'BATCH_STATUS' })).toMatchObject({
      status: 'paused',
      message: expect.stringContaining('网站仍报告网络错误'),
      saved: 1,
      refreshes: 1,
    });
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds repeated unresponsive status checks by the forty-five-second total deadline', async () => {
    const original = mocks.sendMessage.getMockImplementation()!;
    mocks.sendMessage.mockImplementation(async (id, message) =>
      reloaded && message.type === 'PAGE_STATUS' ? new Promise(() => {}) : original(id, message),
    );
    await load();
    await send({ type: 'BATCH_START', maxJobs: 3, autoRefresh: true });
    await vi.advanceTimersByTimeAsync(44999);
    expect((await send({ type: 'BATCH_STATUS' })).status).toBe('recovering');
    await vi.advanceTimersByTimeAsync(2);
    expect(await send({ type: 'BATCH_STATUS' })).toMatchObject({
      status: 'paused',
      message: expect.stringContaining('等待职位列表超时'),
      refreshes: 1,
      visited: 1,
    });
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('reports only bounded wait categories and counts without persisting page diagnostics', async () => {
    const original = mocks.sendMessage.getMockImplementation()!;
    const secret = 'private-token-should-not-be-saved';
    let probes = 0;
    mocks.sendMessage.mockImplementation(async (id, message) => {
      const result = await original(id, message);
      if (!reloaded || message.type !== 'PAGE_STATUS') return result;
      probes += 1;
      if (probes === 1) throw new Error(`Transport failed: ${secret}`);
      if (probes === 2) return { ...result, documentId: 'old-document' };
      if (probes === 3) return { ...result, documentId: undefined };
      return {
        ...result,
        listCount: 0,
        safeForRefresh: false,
        message: `https://example.invalid/?token=${secret}`,
        diagnostics: { html: `<div>${secret}</div>` },
      };
    });
    const result = await run();
    expect(result).toMatchObject({ status: 'paused', saved: 1, refreshes: 1 });
    expect(result.message).toContain('最近：新页面暂无职位');
    expect(result.message).toContain('页面脚本未响应1次');
    expect(result.message).toContain('仍是刷新前页面1次');
    expect(result.message).toContain('缺少页面标识1次');
    expect(result.message).toMatch(/新页面暂无职位\d+次/);
    const persistedMessages = mocks.sessionSet.mock.calls.map(
      ([value]) => value.batch?.message ?? '',
    );
    expect(
      persistedMessages.some((value) => value.includes('最长45秒；最近：页面脚本未响应')),
    ).toBe(true);
    expect(
      persistedMessages.filter((value) => value.includes('最长45秒；最近：')).length,
    ).toBeLessThan(15);
    expect(JSON.stringify(mocks.sessionSet.mock.calls)).not.toContain(secret);
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('distinguishes repeated status timeouts from an empty fresh list', async () => {
    const original = mocks.sendMessage.getMockImplementation()!;
    mocks.sendMessage.mockImplementation(async (id, message) =>
      reloaded && message.type === 'PAGE_STATUS' ? new Promise(() => {}) : original(id, message),
    );
    const result = await run();
    expect(result).toMatchObject({ status: 'paused', visited: 1 });
    expect(result.message).toContain('最近：页面响应超时');
    expect(result.message).toMatch(/页面响应超时\d+次/);
    expect(result.message).not.toContain('页面脚本未响应');
    expect(result.message).not.toContain('新页面暂无职位');
  });
  it.each([
    ['请保持招聘页面在前台', '请保持招聘页面在前台'],
    ['检测到验证或异常，请处理后手动重试', '检测到验证或异常，请处理后手动重试'],
    ['检测到验证或异常，批量读取已暂停；请处理后重新开始', '检测到验证或异常'],
    ['页面指引或遮罩阻挡了职位操作，已暂停；请关闭指引后继续。', '页面指引或遮罩阻挡了职位操作'],
  ])(
    'preserves the explicit safety reason %s instead of waiting for an empty list',
    async (message, reason) => {
      const original = mocks.sendMessage.getMockImplementation()!;
      mocks.sendMessage.mockImplementation(async (id, request) => {
        const result = await original(id, request);
        return reloaded && request.type === 'PAGE_STATUS'
          ? { ...result, listCount: 0, safeForRefresh: false, message }
          : result;
      });
      await load();
      await send({ type: 'BATCH_START', maxJobs: 3, autoRefresh: true });
      await vi.advanceTimersByTimeAsync(1000);
      const result = await send({ type: 'BATCH_STATUS' });
      expect(result).toMatchObject({ status: 'paused', visited: 1, saved: 1, refreshes: 1 });
      expect(result.message).toContain(reason);
      expect(result.message).not.toContain('等待职位列表超时');
      expect(
        mocks.sendMessage.mock.calls.filter(([, request]) => request.type === 'BATCH_PREPARE'),
      ).toHaveLength(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it('does not revive a stopped task when a slow website eventually becomes ready', async () => {
    const original = mocks.sendMessage.getMockImplementation()!;
    mocks.sendMessage.mockImplementation(async (id, message) => {
      const result = await original(id, message);
      return reloaded && message.type === 'PAGE_STATUS' && Date.now() < 1030000
        ? { ...result, listCount: 0, safeForRefresh: false }
        : result;
    });
    await load();
    await send({ type: 'BATCH_START', maxJobs: 3, autoRefresh: true });
    await vi.advanceTimersByTimeAsync(20000);
    expect((await send({ type: 'BATCH_STATUS' })).status).toBe('recovering');
    await send({ type: 'BATCH_STOP' });
    await vi.advanceTimersByTimeAsync(30000);
    expect(await send({ type: 'BATCH_STATUS' })).toMatchObject({
      status: 'stopped',
      visited: 1,
      saved: 1,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('reconstructs only an exact original queue prefix without consuming the old page budget twice', async () => {
    freshQueue = [queue[0]];
    const original = mocks.sendMessage.getMockImplementation()!;
    mocks.sendMessage.mockImplementation(async (id, message) => {
      if (reloaded && message.type === 'BATCH_STEP' && message.kind === 'next_page') {
        freshQueue = [...queue];
        return { ...snapshot(message.taskId), pageNumber: 3, canLoadMore: true };
      }
      const result = await original(id, message);
      if (message.type === 'BATCH_PREPARE' || message.type === 'BATCH_STEP') {
        if (result.targets)
          return {
            ...result,
            pageNumber: reloaded ? (message.type === 'BATCH_PREPARE' ? 1 : 3) : 2,
            canLoadMore: true,
          };
      }
      return result;
    });
    expect(await run(true, { autoPage: true, maxPages: 2 })).toMatchObject({
      status: 'completed',
      saved: 2,
      visited: 2,
      pages: 2,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
