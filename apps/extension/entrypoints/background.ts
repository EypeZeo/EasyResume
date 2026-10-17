import { browser } from 'wxt/browser';
import { localServer, RECRUITING_HOSTS, type Observation } from '../lib/observe';
import {
  pairingInfo,
  reconnectConnection,
  revokeConnection,
  type Connection,
  type ConnectionResult,
} from '../lib/connection';
import type { BatchSnapshot } from '../lib/batch';

type Task = {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'stopped' | 'error';
  saved: number;
  visited: number;
  pages: number;
  maxJobs: number;
  maxPages: number;
  autoPage: boolean;
  message: string;
  tabId?: number;
  taskId?: string;
  installation?: string;
  seen: string[];
};
const emptyTask = (): Task => ({
  status: 'idle',
  saved: 0,
  visited: 0,
  pages: 0,
  maxJobs: 20,
  maxPages: 1,
  autoPage: false,
  message: '',
  seen: [],
});

export default defineBackground(() => {
  const ready = browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  let generation = 0;
  let batchEpoch = 0;
  let task = emptyTask();
  let taskReady: Promise<void> | undefined;
  let loop: Promise<void> | undefined;
  let pairBusy = false;
  let starting = false;
  let connectionWrites: Promise<unknown> = Promise.resolve();
  const mutateConnection = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = connectionWrites.then(operation, operation);
    connectionWrites = result.catch(() => {});
    return result;
  };
  let cached: { at: number; result: ConnectionResult } | undefined;
  let checking: Promise<ConnectionResult> | undefined;
  const errorText = (error: unknown) =>
    error instanceof Error ? error.message : '操作失败，请重试';
  const persist = () => browser.storage.session.set({ batch: task });
  const initialize = () =>
    (taskReady ??= (async () => {
      const stored = await browser.storage.session.get<{ batch?: Task }>('batch');
      if (stored.batch)
        task = {
          ...stored.batch,
          status: stored.batch.status === 'running' ? 'paused' : stored.batch.status,
          message:
            stored.batch.status === 'running'
              ? '扩展后台已重启，请检查页面后继续'
              : stored.batch.message,
        };
    })());

  async function status(force = false, hints: string[] = []): Promise<ConnectionResult> {
    await ready;
    if (checking) return checking;
    const ttl = cached?.result.state === 'connected' ? 3000 : 30000;
    if (!force && cached && Date.now() - cached.at < ttl) return cached.result;
    const epoch = generation;
    checking = (async (): Promise<ConnectionResult> => {
      const stored = await browser.storage.local.get<{ connection?: Connection }>('connection');
      const result = await reconnectConnection(stored.connection, hints);
      if (epoch !== generation) return { state: 'unpaired' };
      if (result.connection && result.connection.base !== stored.connection?.base)
        await mutateConnection(async () => {
          if (epoch === generation)
            await browser.storage.local.set({ connection: result.connection });
        });
      if (epoch !== generation) return { state: 'unpaired' };
      cached = { at: Date.now(), result };
      return result;
    })().finally(() => {
      checking = undefined;
    });
    return checking;
  }
  function publicStatus(result: ConnectionResult) {
    return {
      state: result.state,
      connected: result.state === 'connected',
      paired: !!result.connection,
      base: result.connection?.base,
      installation: result.connection?.installation,
      sending: false,
    };
  }
  async function pair(input: string, bridgeBase?: string, expectedGeneration = generation) {
    if (expectedGeneration !== generation) throw new Error('连接操作已取消');
    if (pairBusy) throw new Error('正在连接工作台，请稍候');
    pairBusy = true;
    const epoch = ++generation;
    cached = undefined;
    try {
      const info = pairingInfo(input);
      if (bridgeBase && info.base !== bridgeBase) throw new Error('连接信息与当前工作台地址不符');
      const response = await fetch(`${info.base}/api/v1/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: info.code, protocol: 1, label: 'Chrome / Edge 职位读取' }),
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      const body = await response.json();
      if (
        !response.ok ||
        body.protocol !== 1 ||
        typeof body.token !== 'string' ||
        !body.token ||
        typeof body.installation_id !== 'string' ||
        !body.installation_id
      )
        throw new Error(body.detail || '连接失败或版本不兼容');
      if (epoch !== generation) throw new Error('连接操作已取消');
      const connection = { base: info.base, token: body.token, installation: body.installation_id };
      await mutateConnection(async () => {
        if (epoch !== generation) throw new Error('连接操作已取消');
        await browser.storage.local.set({ connection, autoPairDisabled: false });
      });
      if (epoch !== generation) throw new Error('连接操作已取消');
      cached = { at: Date.now(), result: { state: 'connected', connection } };
      return { connected: true };
    } finally {
      pairBusy = false;
    }
  }
  async function activeJobTab() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('请先打开 BOSS 或智联职位列表页');
    if (tab.url) {
      const url = new URL(tab.url);
      if (url.protocol !== 'https:' || !RECRUITING_HOSTS.includes(url.hostname))
        throw new Error('请先打开 BOSS 或智联职位列表页');
    }
    return tab as typeof tab & { id: number };
  }
  async function command(tabId: number, message: object) {
    let result;
    try {
      result = await browser.tabs.sendMessage(tabId, message);
    } catch {
      throw new Error('招聘页面未响应，请刷新页面后重新开始');
    }
    if (!result || result.error) throw new Error(result?.error || '招聘页面未响应');
    return result;
  }
  async function save(
    observations: Observation[],
    expectedGeneration = generation,
    installation?: string,
    allowed = () => true,
  ) {
    if (!Array.isArray(observations) || !observations.length || observations.length > 20)
      throw new Error('一次最多保存20条职位');
    const result = await status();
    if (result.state !== 'connected' || !result.connection)
      throw new Error('工作台连接不可用，已暂停；启动工作台后可重试');
    const connection = result.connection;
    if (
      !allowed() ||
      expectedGeneration !== generation ||
      (installation && installation !== connection.installation)
    )
      throw new Error('任务或工作台连接已变化，请重新确认');
    let count = 0,
      duplicates = 0;
    for (const observation of observations) {
      const url = new URL(observation.url);
      if (
        url.protocol !== 'https:' ||
        !RECRUITING_HOSTS.includes(url.hostname) ||
        url.username ||
        url.password
      )
        throw new Error('职位来源不匹配');
      if (!allowed() || expectedGeneration !== generation)
        throw new Error('任务或工作台连接已变化，停止保存');
      const response = await fetch(`${localServer(connection.base)}/api/v1/observations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${connection.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(observation),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || '保存失败，请检查工作台连接');
      if (body.duplicate) duplicates++;
      else count++;
    }
    return { saved: count, duplicates };
  }
  async function cancelBatch(message: string, stopped = false) {
    ++batchEpoch;
    if (task.status === 'running' || task.status === 'paused') {
      task = { ...task, status: stopped ? 'stopped' : 'paused', message };
      await persist();
      if (task.tabId && task.taskId)
        await browser.tabs
          .sendMessage(task.tabId, { type: 'BATCH_STOP', taskId: task.taskId })
          .catch(() => {});
    }
    return { ...task };
  }
  async function runBatch(
    snapshot: BatchSnapshot,
    epoch: number,
    connectionGeneration: number,
    pageOffset = 0,
  ) {
    try {
      while (task.status === 'running' && epoch === batchEpoch) {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id !== task.tabId) throw new Error('招聘页面已切到后台，请回到原页面后继续');
        const target = snapshot.targets.find((t) => !task.seen.includes(t.key));
        if (
          task.visited >= task.maxJobs ||
          (!target && (!task.autoPage || !snapshot.canNextPage || task.pages >= task.maxPages))
        ) {
          task = {
            ...task,
            status: 'completed',
            message: target
              ? '已达到读取数量上限'
              : '当前可读取的岗位已完成；没有可用的下一页时不会盲目翻页',
          };
          await persist();
          return;
        }
        const step = await command(task.tabId!, {
          type: 'BATCH_STEP',
          taskId: task.taskId,
          documentId: snapshot.documentId,
          pageKey: snapshot.pageKey,
          kind: target ? 'job' : 'next_page',
          targetKey: target?.key,
        });
        if (epoch !== batchEpoch || task.status !== 'running') return;
        snapshot = step;
        task.pages = pageOffset + snapshot.pageNumber;
        if (step.observation && target) {
          const savingTaskId = task.taskId;
          const saved = await save(
            [step.observation],
            connectionGeneration,
            task.installation,
            () => epoch === batchEpoch && task.status === 'running',
          );
          if (savingTaskId === task.taskId && !task.seen.includes(target.key)) {
            task.seen.push(target.key);
            task.visited++;
            task.saved += saved.saved;
            task.message =
              epoch === batchEpoch
                ? saved.duplicates
                  ? '已跳过已存在的职位'
                  : `已保存：${step.observation.title}`
                : '已暂停；暂停前开始保存的岗位已完成';
          }
          if (epoch !== batchEpoch || task.status !== 'running') {
            await persist();
            return;
          }
        }
        if (step.done) task = { ...task, status: 'completed', message: '本次批量读取已完成' };
        await persist();
      }
    } catch (error) {
      if (epoch === batchEpoch) await cancelBatch(errorText(error));
    }
  }
  async function startBatch(message: any, resume = false) {
    if (starting || loop || task.status === 'running')
      throw new Error('已有批量任务正在执行或停止，请稍候');
    starting = true;
    const connectionGeneration = generation;
    const epoch = ++batchEpoch;
    try {
      const connection = await status(true);
      if (connection.state !== 'connected' || !connection.connection)
        throw new Error('请先连接工作台');
      const tab = await activeJobTab();
      if (resume && tab.id !== task.tabId) throw new Error('请回到原批量任务的招聘标签页');
      const maxJobs = resume ? task.maxJobs : Number(message.maxJobs ?? 20);
      const maxPages = resume
        ? task.maxPages
        : message.autoPage === true
          ? Number(message.maxPages ?? 2)
          : 1;
      if (
        !Number.isInteger(maxJobs) ||
        maxJobs < 1 ||
        maxJobs > 100 ||
        !Number.isInteger(maxPages) ||
        maxPages < 1 ||
        maxPages > 5
      )
        throw new Error('批量范围为1–100条、1–5页');
      if (resume && task.installation !== connection.connection.installation)
        throw new Error('已切换工作台，请停止旧任务后重新开始');
      const taskId = crypto.randomUUID();
      const pageOffset = resume ? Math.max(0, task.pages - 1) : 0;
      const snapshot: BatchSnapshot = await command(tab.id, {
        type: 'BATCH_PREPARE',
        taskId,
        options: {
          maxItems: maxJobs,
          maxPages: resume ? Math.max(1, maxPages - task.pages + 1) : maxPages,
          allowNextPage: resume ? task.autoPage : message.autoPage === true,
        },
      });
      if (epoch !== batchEpoch || connectionGeneration !== generation)
        throw new Error('批量任务已取消');
      task = {
        ...(resume ? task : emptyTask()),
        status: 'running',
        tabId: tab.id,
        taskId,
        maxJobs,
        maxPages,
        autoPage: resume ? task.autoPage : message.autoPage === true,
        pages: resume ? task.pages : 1,
        installation: connection.connection.installation,
        message: '正在逐条读取右侧详情',
      };
      await persist();
      const started = { ...task };
      loop = runBatch(snapshot, epoch, generation, pageOffset).finally(() => {
        loop = undefined;
      });
      return started;
    } finally {
      starting = false;
    }
  }
  async function hints() {
    const tabs = await browser.tabs.query({ url: 'http://127.0.0.1/*' });
    return [
      ...new Set(
        tabs.flatMap((tab) => {
          try {
            return [localServer(new URL(tab.url!).origin)];
          } catch {
            return [];
          }
        }),
      ),
    ];
  }
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const trusted =
      sender.id === browser.runtime.id &&
      sender.url?.startsWith(`chrome-extension://${browser.runtime.id}/`);
    let bridgeBase = '';
    if (
      !trusted &&
      sender.id === browser.runtime.id &&
      sender.frameId === 0 &&
      ['WORKBENCH_BRIDGE_STATUS', 'WORKBENCH_BRIDGE_PAIR'].includes(message?.type)
    ) {
      try {
        const url = new URL(sender.url!);
        if (url.pathname === '/' || url.pathname === '/index.html')
          bridgeBase = localServer(url.origin);
      } catch {
        /* reject */
      }
    }
    if (!trusted && !bridgeBase) return;
    void (async () => {
      await ready;
      await initialize();
      const commandGeneration = generation;
      if (bridgeBase) {
        const stored = await browser.storage.local.get<{
          connection?: Connection;
          autoPairDisabled?: boolean;
        }>(['connection', 'autoPairDisabled']);
        if (message.type === 'WORKBENCH_BRIDGE_STATUS') {
          const result = await status(true, [bridgeBase]);
          return {
            connected: result.state === 'connected',
            needs_pairing: !stored.connection && !stored.autoPairDisabled,
          };
        }
        if (stored.connection || stored.autoPairDisabled)
          throw new Error('自动连接已停用，请在扩展中手动连接');
        return pair(String(message.info ?? ''), bridgeBase, commandGeneration);
      }
      if (message?.type === 'STATUS') return publicStatus(await status());
      if (message?.type === 'AUTO_CONNECT') {
        let result = await status(true, await hints());
        if (commandGeneration !== generation) throw new Error('连接操作已取消');
        await mutateConnection(async () => {
          if (commandGeneration !== generation) throw new Error('连接操作已取消');
          if (result.state === 'expired') {
            await browser.storage.local.remove('connection');
            cached = undefined;
            result = { state: 'unpaired' };
          }
          await browser.storage.local.set({ autoPairDisabled: false });
        });
        if (commandGeneration !== generation) throw new Error('连接操作已取消');
        if (result.state === 'unpaired') {
          for (const tab of await browser.tabs.query({ url: 'http://127.0.0.1/*' }))
            if (tab.id)
              await browser.tabs
                .sendMessage(tab.id, { type: 'WORKBENCH_RECONNECT' })
                .catch(() => {});
        }
        return publicStatus(await status(true, await hints()));
      }
      if (message?.type === 'PAIR') {
        if (task.status === 'running') throw new Error('请先停止批量任务再切换连接');
        const input =
          message.info ||
          JSON.stringify({
            base: localServer(String(message.base)),
            code: String(message.code ?? '').trim(),
            protocol: 1,
            expires_at: new Date(Date.now() + 60000).toISOString(),
          });
        return pair(input, undefined, commandGeneration);
      }
      if (message?.type === 'DISCONNECT') {
        const epoch = ++generation;
        cached = undefined;
        const stored = await browser.storage.local.get<{ connection?: Connection }>('connection');
        await mutateConnection(async () => {
          await browser.storage.local.set({ autoPairDisabled: true });
          await browser.storage.local.remove('connection');
        });
        await cancelBatch('连接已断开，批量任务已停止', true);
        const proven = await reconnectConnection(stored.connection, await hints());
        const revoked =
          proven.state === 'expired' ||
          (proven.state === 'connected' && (await revokeConnection(proven.connection)));
        if (epoch === generation) cached = { at: Date.now(), result: { state: 'unpaired' } };
        return { disconnected: true, server_revoked: !stored.connection || revoked };
      }
      if (message?.type === 'BATCH_STATUS') return { ...task };
      if (message?.type === 'BATCH_START') return startBatch(message);
      if (message?.type === 'BATCH_RESUME') {
        if (task.status !== 'paused') throw new Error('没有可继续的任务');
        return startBatch(message, true);
      }
      if (message?.type === 'BATCH_PAUSE') return cancelBatch('已暂停，可回到原页面继续');
      if (message?.type === 'BATCH_STOP') return cancelBatch('批量任务已停止', true);
      if (['READ', 'READ_SELECTION', 'SAVE'].includes(message?.type) && task.status === 'running')
        throw new Error('批量任务正在执行，请先暂停或停止');
      if (message?.type === 'READ' || message?.type === 'READ_SELECTION') {
        const tab = await activeJobTab();
        return command(tab.id, {
          type: message.type === 'READ_SELECTION' ? 'COLLECT_SELECTION' : 'COLLECT_CURRENT_PAGE',
        });
      }
      if (message?.type === 'SAVE') return save(message.observations);
      throw new Error('不支持的操作；此扩展没有发送或审批能力');
    })()
      .then(sendResponse)
      .catch((error) => sendResponse({ error: errorText(error) }));
    return true;
  });
});
