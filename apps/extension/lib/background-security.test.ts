import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  reconnect: vi.fn(),
  revoke: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  query: vi.fn(),
  sendMessage: vi.fn(),
}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { id: 'synthetic-extension', onMessage: { addListener: mocks.addListener } },
    storage: {
      local: {
        setAccessLevel: async () => {},
        get: mocks.get,
        set: mocks.set,
        remove: mocks.remove,
      },
      session: { get: async () => ({}), set: async () => {} },
    },
    tabs: { query: mocks.query, sendMessage: mocks.sendMessage },
  },
}));
vi.mock('./connection', () => ({
  reconnectConnection: mocks.reconnect,
  revokeConnection: mocks.revoke,
  pairingInfo: (input: string) => JSON.parse(input),
}));

const connection = {
  base: 'http://127.0.0.1:8765',
  token: 'synthetic-token',
  installation: 'synthetic-id',
};
const trusted = {
  id: 'synthetic-extension',
  url: 'chrome-extension://synthetic-extension/popup.html',
};
const bridge = { id: 'synthetic-extension', url: connection.base + '/', frameId: 0 };
const settle = async () => {
  for (let index = 0; index < 30; index++) await Promise.resolve();
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
let data: Record<string, unknown>;
let now: number;
let listener: (...args: any[]) => unknown;

async function load() {
  await import('../entrypoints/background');
  listener = mocks.addListener.mock.calls[0][0];
}
function send(message: object, sender: object = trusted): Promise<any> {
  return new Promise((resolve) => {
    if (listener(message, sender, resolve) !== true) resolve({ ignored: true });
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal('defineBackground', (main: () => void) => main());
  data = { connection: { ...connection } };
  now = 100000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  mocks.get.mockImplementation(async () => structuredClone(data));
  mocks.set.mockImplementation(async (changes) => Object.assign(data, structuredClone(changes)));
  mocks.remove.mockImplementation(async (key) => {
    delete data[key];
  });
  mocks.reconnect.mockImplementation(async (stored) =>
    stored ? { state: 'connected', connection: stored } : { state: 'unpaired' },
  );
  mocks.revoke.mockResolvedValue(true);
  mocks.query.mockImplementation(async (query) =>
    query.url ? [] : [{ id: 4, url: 'https://www.zhipin.com/web/geek/jobs' }],
  );
  mocks.sendMessage.mockResolvedValue({ stopped: true });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('background connection and cancellation boundary', () => {
  it.each([
    [{ status: 'awaiting_review' }, { saved: 1, duplicates: 0, pendingReview: 0, unconfirmed: 0 }],
    [{ status: 'repeat' }, { saved: 0, duplicates: 1, pendingReview: 0, unconfirmed: 0 }],
    [{ duplicate: true }, { saved: 0, duplicates: 1, pendingReview: 0, unconfirmed: 0 }],
    [
      { status: 'changed_requires_review' },
      { saved: 0, duplicates: 0, pendingReview: 1, unconfirmed: 0 },
    ],
    [{}, { saved: 0, duplicates: 0, pendingReview: 0, unconfirmed: 1 }],
    [{ status: 'future_status' }, { saved: 0, duplicates: 0, pendingReview: 0, unconfirmed: 1 }],
    [null, { saved: 0, duplicates: 0, pendingReview: 0, unconfirmed: 1 }],
  ])('counts observation response %j without inventing new jobs', async (body, counts) => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body)));
    await load();
    expect(
      await send({
        type: 'SAVE',
        observations: [
          { url: 'https://www.zhipin.com/job_detail/synthetic.html', title: '合成岗位' },
        ],
      }),
    ).toEqual(counts);
  });

  it('separates new jobs, repeat observations, pending changes and unknown outcomes in one save', async () => {
    const responses = [
      { status: 'awaiting_review' },
      { status: 'repeat' },
      { duplicate: true },
      { status: 'changed_requires_review' },
      {},
    ];
    vi.mocked(fetch).mockImplementation(
      async () => new Response(JSON.stringify(responses.shift())),
    );
    await load();
    expect(
      await send({
        type: 'SAVE',
        observations: Array.from({ length: 5 }, (_, index) => ({
          url: `https://www.zhipin.com/job_detail/synthetic-${index}.html`,
          title: `合成岗位${index}`,
        })),
      }),
    ).toEqual({ saved: 1, duplicates: 2, pendingReview: 1, unconfirmed: 1 });
  });

  it('keeps a changed job pending review in batch totals instead of counting it as new', async () => {
    const snapshot = {
      documentId: 'synthetic-document',
      href: 'https://www.zhipin.com/web/geek/jobs',
      pageKey: 'page-one',
      pageNumber: 1,
      completed: 0,
      targets: [{ key: 'first', title: '合成岗位' }],
      canNextPage: false,
    };
    mocks.sendMessage.mockImplementation(async (_tab, message) =>
      message.type === 'PAGE_STATUS'
        ? { page: { platform: 'boss', kind: 'list' }, entries: [], canRead: true, listCount: 1 }
        : message.type === 'BATCH_PREPARE'
          ? { ...snapshot, taskId: message.taskId }
          : message.type === 'BATCH_STEP'
            ? {
                ...snapshot,
                taskId: message.taskId,
                done: true,
                observation: {
                  url: 'https://www.zhipin.com/job_detail/synthetic.html',
                  title: '合成岗位',
                },
              }
            : { stopped: true },
    );
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: 'changed_requires_review' })),
    );
    await load();
    expect((await send({ type: 'BATCH_START', maxJobs: 1 })).status).toBe('running');
    await settle();
    expect(await send({ type: 'BATCH_STATUS' })).toMatchObject({
      status: 'completed',
      visited: 1,
      saved: 0,
      pendingReview: 1,
      duplicates: 0,
      unconfirmed: 0,
    });
  });

  it('rejects recruitment-page proxies, remote origins and subframe bridges', async () => {
    await load();
    for (const sender of [
      { ...bridge, url: 'https://www.zhipin.com/' },
      { ...bridge, frameId: 1 },
      { ...bridge, url: connection.base + '/another-app' },
    ])
      expect(await send({ type: 'WORKBENCH_BRIDGE_STATUS' }, sender)).toEqual({ ignored: true });
    expect(await send({ type: 'SAVE', observations: [] }, bridge)).toEqual({ ignored: true });
    expect(await send({ type: 'PAIR', info: '{}' }, bridge)).toEqual({ ignored: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns only pairing eligibility to the bridge and binds offers to its origin', async () => {
    data = {};
    await load();
    const status = await send({ type: 'WORKBENCH_BRIDGE_STATUS' }, bridge);
    expect(status).toEqual({ connected: false, needs_pairing: true });
    const result = await send(
      {
        type: 'WORKBENCH_BRIDGE_PAIR',
        info: JSON.stringify({
          base: 'http://127.0.0.1:8766',
          code: 'synthetic-code',
          protocol: 1,
        }),
      },
      bridge,
    );
    expect(result.error).toContain('地址不符');
    expect(data.connection).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not restore a connection when a pairing response arrives after Disconnect', async () => {
    data = {};
    const response = deferred<Response>();
    vi.mocked(fetch).mockReturnValue(response.promise);
    await load();
    const pairing = send({
      type: 'PAIR',
      info: JSON.stringify({ base: connection.base, code: 'synthetic-code', protocol: 1 }),
    });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await send({ type: 'DISCONNECT' })).disconnected).toBe(true);
    response.resolve(
      new Response(
        JSON.stringify({ protocol: 1, token: 'late-token', installation_id: 'late-id' }),
      ),
    );
    expect((await pairing).error).toContain('已取消');
    expect(data.connection).toBeUndefined();
    expect(data.autoPairDisabled).toBe(true);
  });

  it('serializes a delayed port update before disconnect removal', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    mocks.reconnect.mockResolvedValue({
      state: 'connected',
      connection: { ...connection, base: 'http://127.0.0.1:8766' },
    });
    mocks.set.mockImplementation(async (changes) => {
      if (changes.connection?.base === 'http://127.0.0.1:8766') {
        entered.resolve();
        await release.promise;
      }
      Object.assign(data, structuredClone(changes));
    });
    await load();
    const status = send({ type: 'STATUS' });
    await entered.promise;
    const disconnect = send({ type: 'DISCONNECT' });
    await settle();
    release.resolve();
    expect((await status).state).toBe('unpaired');
    expect((await disconnect).disconnected).toBe(true);
    expect(data.connection).toBeUndefined();
    expect(data.autoPairDisabled).toBe(true);
  });

  it('checks the new connection instead of reusing a check from before pairing', async () => {
    data = {};
    const oldCheck = deferred<any>();
    mocks.reconnect.mockReturnValueOnce(oldCheck.promise);
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          protocol: 1,
          token: connection.token,
          installation_id: connection.installation,
        }),
      ),
    );
    await load();
    const earlier = send({ type: 'STATUS' });
    await settle();
    expect(
      (
        await send({
          type: 'PAIR',
          info: JSON.stringify({ base: connection.base, code: 'synthetic-code', protocol: 1 }),
        })
      ).connected,
    ).toBe(true);
    const current = await send({ type: 'STATUS' });
    expect(current.connected).toBe(true);
    oldCheck.resolve({ state: 'unpaired' });
    expect((await earlier).state).toBe('unpaired');
    expect((await send({ type: 'STATUS' })).connected).toBe(true);
  });

  it('does not save a late batch observation after pausing during connection validation', async () => {
    const step = deferred<any>();
    const checking = deferred<any>();
    const snapshot = {
      taskId: 'synthetic-task',
      documentId: 'synthetic-document',
      href: 'https://www.zhipin.com/web/geek/jobs',
      pageKey: 'page-one',
      pageNumber: 1,
      completed: 0,
      targets: [{ key: 'first', title: '合成岗位' }],
      canNextPage: false,
    };
    mocks.sendMessage.mockImplementation(async (_tab, message) =>
      message.type === 'PAGE_STATUS'
        ? { page: { platform: 'boss', kind: 'list' }, entries: [], canRead: true, listCount: 1 }
        : message.type === 'BATCH_PREPARE'
          ? { ...snapshot, taskId: message.taskId }
          : message.type === 'BATCH_STEP'
            ? step.promise
            : { stopped: true },
    );
    mocks.reconnect
      .mockResolvedValueOnce({ state: 'connected', connection })
      .mockReturnValueOnce(checking.promise);
    await load();
    expect((await send({ type: 'BATCH_START', maxJobs: 2 })).status).toBe('running');
    now += 5000;
    step.resolve({
      ...snapshot,
      observation: { url: 'https://www.zhipin.com/job_detail/synthetic.html', title: '合成岗位' },
    });
    await settle();
    expect(mocks.reconnect).toHaveBeenCalledTimes(2);
    expect((await send({ type: 'BATCH_PAUSE' })).status).toBe('paused');
    checking.resolve({ state: 'connected', connection });
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect((await send({ type: 'BATCH_STATUS' })).saved).toBe(0);
  });
});
