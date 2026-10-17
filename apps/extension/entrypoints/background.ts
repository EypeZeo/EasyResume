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
import {
  chooseRecruitingEntrypoint,
  classifyRecruitingPage,
  resolveRecruitingTab,
  type RecruitingPageStatus,
  type RecruitingPlatform,
} from '../lib/navigation';

type NavigationRequest = {
  tabId?: number;
  platform?: RecruitingPlatform;
  purpose?: 'current' | 'batch';
  entryUrl?: string;
};
class PageSelectionError extends Error {
  readonly code = 'NEEDS_SELECTION';
  constructor(readonly choices: object[]) {
    super('发现多个招聘页面，请选择本次要读取的页面');
  }
}
class PageReadError extends Error {
  constructor(
    message: string,
    readonly diagnostics?: unknown,
  ) {
    super(message);
  }
}
class PageCommandTimeout extends PageReadError {}

async function bounded<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeout: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(timeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

type NavigationLifetime = {
  deadline: number;
  cancelled: boolean;
  message?: string;
  diagnostics?: unknown;
};

type Task = {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'stopped' | 'error';
  saved: number;
  duplicates?: number;
  pendingReview?: number;
  unconfirmed?: number;
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
  scope?: { platform: RecruitingPlatform; href: string };
};
const emptyTask = (): Task => ({
  status: 'idle',
  saved: 0,
  duplicates: 0,
  pendingReview: 0,
  unconfirmed: 0,
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
  let navigationBusy = false;
  let connectionWrites: Promise<unknown> = Promise.resolve();
  const mutateConnection = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = connectionWrites.then(operation, operation);
    connectionWrites = result.catch(() => {});
    return result;
  };
  let cached: { at: number; result: ConnectionResult } | undefined;
  let checking: { epoch: number; promise: Promise<ConnectionResult> } | undefined;
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
    if (checking?.epoch === generation) return checking.promise;
    const ttl = cached?.result.state === 'connected' ? 3000 : 30000;
    if (!force && cached && Date.now() - cached.at < ttl) return cached.result;
    const epoch = generation;
    const promise = (async (): Promise<ConnectionResult> => {
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
      if (checking?.promise === promise) checking = undefined;
    });
    checking = { epoch, promise };
    return promise;
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
  async function activeJobTab(request: NavigationRequest = {}, selection = false) {
    if (navigationBusy) throw new Error('正在定位招聘页面，请稍候');
    navigationBusy = true;
    const navigation: NavigationLifetime = { deadline: Date.now() + 12000, cancelled: false };
    try {
      return await bounded(resolveJobTab(request, selection, navigation), 12000, () => {
        navigation.cancelled = true;
        return new PageReadError(
          `${navigation.message || '招聘页面定位'}。等待页面超时，请检查后重试；不会重复跳转`,
          navigation.diagnostics,
        );
      });
    } finally {
      navigation.cancelled = true;
      navigationBusy = false;
    }
  }
  async function resolveJobTab(
    request: NavigationRequest,
    selection: boolean,
    navigation: NavigationLifetime,
  ) {
    const checkNavigation = () => {
      if (navigation.cancelled || Date.now() >= navigation.deadline)
        throw new PageReadError(
          '招聘页面定位超时，请检查后重试；不会重复跳转',
          navigation.diagnostics,
        );
    };
    const pageStatus = (tabId: number) => {
      checkNavigation();
      return command(
        tabId,
        { type: 'PAGE_STATUS' },
        Math.min(2000, navigation.deadline - Date.now()),
      );
    };
    if (request.platform !== undefined && !['boss', 'zhilian'].includes(request.platform))
      throw new Error('招聘平台选择无效');
    if (request.purpose !== undefined && !['current', 'batch'].includes(request.purpose))
      throw new Error('读取方式无效');
    const [active] = await browser.tabs.query({ active: true, currentWindow: true });
    checkNavigation();
    if (active?.id === undefined) throw new Error('请先打开 BOSS 或智联招聘页面');
    const tabs = await browser.tabs.query({ currentWindow: true });
    checkNavigation();
    const scoped = tabs.filter(
      (tab) =>
        tab.id !== undefined &&
        tab.windowId === active.windowId &&
        !!tab.incognito === !!active.incognito,
    );
    const resolution = resolveRecruitingTab(
      scoped.map((tab) => ({
        id: tab.id!,
        windowId: tab.windowId ?? 0,
        incognito: !!tab.incognito,
        url: tab.url,
        title: tab.title,
      })),
      {
        windowId: active.windowId ?? 0,
        incognito: !!active.incognito,
        activeTabId: active.id,
        platform: request.platform,
        purpose: request.purpose ?? 'current',
      },
    );
    if (resolution.state === 'blocked')
      throw new Error('当前是登录、验证或个人页面，请处理后打开职位列表再读取');
    let target = active;
    let navigated = false;
    let needsEntry = false;
    const expectedPlatform = request.platform ?? classifyRecruitingPage(active.url).platform;
    if (request.tabId !== undefined) {
      if (!Number.isInteger(request.tabId)) throw new Error('招聘页面选择无效');
      const chosen = scoped.find((tab) => tab.id === request.tabId);
      const page = classifyRecruitingPage(chosen?.url);
      if (
        !chosen ||
        (expectedPlatform && page.platform !== expectedPlatform) ||
        (page.kind !== 'home' &&
          page.kind !== 'list' &&
          (request.purpose === 'batch' || page.kind !== 'detail'))
      )
        throw new Error('所选招聘页面已变化，请重新选择');
      target = chosen;
      needsEntry = page.kind === 'home';
    } else if (resolution.state === 'ready' || resolution.state === 'activate') {
      target = scoped.find((tab) => tab.id === resolution.choice.tabId)!;
    } else if (resolution.state === 'choose') {
      throw new PageSelectionError(
        resolution.choices.map((choice) => ({ ...choice, kind: 'tab' })),
      );
    } else {
      const homes = scoped.filter((tab) => {
        const page = classifyRecruitingPage(tab.url);
        return page.kind === 'home' && (!expectedPlatform || page.platform === expectedPlatform);
      });
      const currentHome = homes.find((tab) => tab.id === active.id);
      if (currentHome) target = currentHome;
      else if (homes.length === 1) target = homes[0];
      else if (homes.length > 1)
        throw new PageSelectionError(
          homes.map((tab) => ({
            kind: 'tab',
            tabId: tab.id,
            platform: classifyRecruitingPage(tab.url).platform,
            title:
              tab.title?.trim().slice(0, 120) ||
              (classifyRecruitingPage(tab.url).platform === 'boss' ? 'BOSS 首页' : '智联首页'),
          })),
        );
      else
        throw new Error(
          `请先打开${expectedPlatform === 'boss' ? ' BOSS ' : expectedPlatform === 'zhilian' ? '智联' : ' BOSS 或智联'}招聘网页的“职位”页面`,
        );
      needsEntry = true;
    }
    const selectedPlatform = classifyRecruitingPage(target.url).platform;
    const selectedHref = target.url;
    if (target.id !== active.id) await browser.tabs.update(target.id!, { active: true });
    checkNavigation();
    if (needsEntry) {
      const page = (await pageStatus(target.id!)) as RecruitingPageStatus;
      checkNavigation();
      if (
        page.page?.kind !== 'home' ||
        (expectedPlatform && page.page.platform !== expectedPlatform)
      )
        throw new Error('招聘首页已变化，请重新定位');
      const entry = chooseRecruitingEntrypoint(page.entries ?? []);
      const chosen = request.entryUrl
        ? page.entries?.find((item) => item.url === request.entryUrl)
        : entry.state === 'ready'
          ? entry.entry
          : undefined;
      if (request.entryUrl && !chosen) throw new Error('职位入口已变化，请重新定位招聘页面');
      if (!chosen && entry.state === 'choose')
        throw new PageSelectionError(
          entry.entries.map((item) => ({
            kind: 'entry',
            entryUrl: item.url,
            title: item.text || '招聘职位',
          })),
        );
      if (!chosen) throw new Error('未找到职位入口，请先在 BOSS 或智联网页点击“职位”');
      await browser.tabs.update(target.id!, { url: chosen.url, active: true });
      checkNavigation();
      navigated = true;
    }
    let lastMessage = '';
    let lastDiagnostics: unknown;
    for (let attempt = 0; attempt < 24; attempt++) {
      if (attempt || navigated) await new Promise((resolve) => setTimeout(resolve, 500));
      checkNavigation();
      const live = (await browser.tabs.query({ currentWindow: true })).find(
        (tab) => tab.id === target.id,
      );
      checkNavigation();
      if (!live || live.windowId !== active.windowId || !!live.incognito !== !!active.incognito)
        throw new Error('招聘页面已关闭或移到其他窗口，请重新选择');
      const location = classifyRecruitingPage(live.url);
      if (location.platform !== selectedPlatform || (!navigated && live.url !== selectedHref))
        throw new Error('招聘页面的平台或列表范围已变化，请重新选择');
      if (['verification', 'login', 'chat'].includes(location.kind))
        throw new Error('招聘页面进入登录、验证或个人页面，已停止定位');
      let page: RecruitingPageStatus;
      try {
        page = await pageStatus(target.id!);
        checkNavigation();
      } catch (error) {
        if (error instanceof PageCommandTimeout || navigation.cancelled) throw error;
        lastMessage = errorText(error);
        if (error instanceof PageReadError && error.diagnostics !== undefined) {
          lastDiagnostics = error.diagnostics;
          navigation.diagnostics = error.diagnostics;
        }
        continue;
      }
      if (['verification', 'login', 'chat'].includes(page.page?.kind))
        throw new Error('招聘页面进入登录、验证或个人页面，已停止定位');
      if (page.page?.platform !== selectedPlatform)
        throw new Error('招聘页面的平台已变化，请重新选择');
      const supported = page.page?.kind === 'list' || page.page?.kind === 'detail';
      if (
        supported &&
        (request.purpose === 'batch'
          ? page.page.kind === 'list' && page.listCount > 0
          : selection || page.canRead)
      )
        return { ...live, id: target.id! };
      lastMessage =
        page.message ??
        (page.page?.kind === 'home' ? '招聘网站返回了首页' : '职位详情尚未加载完成');
      if (page.diagnostics !== undefined) {
        lastDiagnostics = page.diagnostics;
        navigation.diagnostics = page.diagnostics;
      }
      navigation.message = lastMessage;
    }
    throw new PageReadError(
      `${lastMessage || '职位页面尚未就绪'}。请在网页选中职位后重试；不会重复跳转`,
      lastDiagnostics,
    );
  }
  async function command(tabId: number, message: object, timeoutMs?: number) {
    let result;
    const type = (message as { type?: string }).type;
    const limit =
      timeoutMs ??
      (type === 'PAGE_STATUS' || type === 'BATCH_STOP'
        ? 2000
        : type === 'BATCH_STEP'
          ? 18000
          : 5000);
    try {
      result = await bounded(
        browser.tabs.sendMessage(tabId, message),
        limit,
        () => new PageCommandTimeout('招聘页面响应超时，本次操作结果尚未确认；请检查页面后重试'),
      );
    } catch (error) {
      if (error instanceof PageCommandTimeout) throw error;
      throw new Error('招聘页面未响应，请刷新页面后重新开始');
    }
    if (!result || result.error)
      throw new PageReadError(result?.error || '招聘页面未响应', result?.diagnostics);
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
      duplicates = 0,
      pendingReview = 0,
      unconfirmed = 0;
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
      if (body?.duplicate === true || body?.status === 'repeat') duplicates++;
      else if (body?.status === 'awaiting_review') count++;
      else if (body?.status === 'changed_requires_review') pendingReview++;
      else unconfirmed++;
    }
    return { saved: count, duplicates, pendingReview, unconfirmed };
  }
  async function cancelBatch(message: string, stopped = false) {
    ++batchEpoch;
    if (task.status === 'running' || task.status === 'paused') {
      task = { ...task, status: stopped ? 'stopped' : 'paused', message };
      await persist();
      if (task.tabId && task.taskId)
        await command(task.tabId, { type: 'BATCH_STOP', taskId: task.taskId }).catch(() => {});
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
            message:
              task.visited >= task.maxJobs
                ? '已达到读取数量上限'
                : snapshot.endOfList
                  ? '没有更多职位，本次批量读取已完成'
                  : !task.autoPage
                    ? '当前列表已读完；未开启自动加载下一批'
                    : task.pages >= task.maxPages
                      ? '已达到读取页数上限'
                      : '未识别到下一批加载入口，已停止；不代表网站没有更多职位',
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
        const page = classifyRecruitingPage(step.href);
        const previousUrl = task.scope && new URL(task.scope.href);
        const nextUrl = new URL(step.href);
        if (
          !task.scope ||
          page.platform !== task.scope.platform ||
          page.kind !== 'list' ||
          nextUrl.origin !== previousUrl!.origin ||
          nextUrl.pathname !== previousUrl!.pathname ||
          (target && nextUrl.href !== task.scope.href)
        )
          throw new Error('职位列表范围已变化，请停止旧任务后重新开始');
        task.scope = { platform: task.scope.platform, href: nextUrl.href };
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
            task.duplicates = (task.duplicates ?? 0) + saved.duplicates;
            task.pendingReview = (task.pendingReview ?? 0) + saved.pendingReview;
            task.unconfirmed = (task.unconfirmed ?? 0) + saved.unconfirmed;
            task.message =
              epoch === batchEpoch
                ? saved.unconfirmed
                  ? `保存结果待核对：${step.observation.title}`
                  : saved.pendingReview
                    ? `职位更新待核对：${step.observation.title}`
                    : saved.duplicates
                      ? '已跳过已存在的职位'
                      : `新增岗位待核对：${step.observation.title}`
                : '已暂停；暂停前开始处理的岗位结果已记录';
          }
          if (epoch !== batchEpoch || task.status !== 'running') {
            await persist();
            return;
          }
        }
        if (step.done)
          task = {
            ...task,
            status: 'completed',
            message: step.endOfList ? '没有更多职位，本次批量读取已完成' : '本次批量读取已完成',
          };
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
      if (resume) {
        if (!task.scope) throw new Error('此任务缺少页面范围信息，请停止旧任务后重新开始');
        const original = (await browser.tabs.query({ currentWindow: true })).find(
          (tab) => tab.id === task.tabId,
        );
        if (
          !original?.url ||
          new URL(original.url).href !== task.scope.href ||
          classifyRecruitingPage(original.url).platform !== task.scope.platform
        )
          throw new Error('职位平台、城市或搜索范围已变化，请停止旧任务后重新开始');
      }
      const tab = resume
        ? await activeJobTab({ tabId: task.tabId, purpose: 'batch' })
        : await activeJobTab({ ...message, purpose: 'batch' });
      if (resume && tab.id !== task.tabId) throw new Error('请回到原批量任务的招聘标签页');
      if (resume && (!tab.url || new URL(tab.url).href !== task.scope!.href))
        throw new Error('职位列表范围已变化，请停止旧任务后重新开始');
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
      const scopePage = classifyRecruitingPage(snapshot.href);
      if (
        !scopePage.platform ||
        scopePage.platform !== classifyRecruitingPage(tab.url).platform ||
        scopePage.kind !== 'list' ||
        new URL(snapshot.href).href !== new URL(tab.url!).href ||
        (resume && new URL(snapshot.href).href !== task.scope!.href)
      )
        throw new Error('职位列表范围已变化，请停止旧任务后重新开始');
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
        scope: { platform: scopePage.platform, href: new URL(snapshot.href).href },
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
  async function handleCommand(message: any, commandGeneration = generation) {
    if (message?.type === 'LOCATE_JOB_PAGE') {
      if (task.status === 'running') throw new Error('批量任务正在执行，请先暂停或停止');
      const tab = await activeJobTab(message);
      return { located: true, tabId: tab.id, page: await command(tab.id, { type: 'PAGE_STATUS' }) };
    }
    if (message?.type === 'PAGE_STATUS') {
      const tabs = await browser.tabs.query({ currentWindow: true });
      const active = tabs.find((tab) => tab.active);
      const tab =
        message.tabId === undefined
          ? active
          : tabs.find(
              (tab) =>
                tab.id === message.tabId &&
                tab.windowId === active?.windowId &&
                !!tab.incognito === !!active?.incognito,
            );
      if (tab?.id === undefined) throw new Error('请先选择招聘页面');
      return command(tab.id, { type: 'PAGE_STATUS' });
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
            await browser.tabs.sendMessage(tab.id, { type: 'WORKBENCH_RECONNECT' }).catch(() => {});
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
      const tab = await activeJobTab(
        { ...message, purpose: 'current' },
        message.type === 'READ_SELECTION',
      );
      const result = await command(tab.id, {
        type: message.type === 'READ_SELECTION' ? 'COLLECT_SELECTION' : 'COLLECT_CURRENT_PAGE',
      });
      const live = (await browser.tabs.query({ currentWindow: true })).find(
        (item) => item.id === tab.id,
      );
      if (!result.source?.href || !result.source?.platform)
        throw new Error('招聘页面使用了旧版读取脚本，请刷新该网页后重试');
      if (
        result.source.href !== tab.url ||
        live?.url !== tab.url ||
        result.source.platform !== classifyRecruitingPage(tab.url).platform
      )
        throw new Error('读取期间招聘页面的平台或列表范围已变化，请重新读取');
      return result;
    }
    if (message?.type === 'SAVE') return save(message.observations);
    throw new Error('不支持的操作；此扩展没有发送或审批能力');
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
      ['WORKBENCH_BRIDGE_STATUS', 'WORKBENCH_BRIDGE_PAIR', 'WORKBENCH_BRIDGE_COMMAND'].includes(
        message?.type,
      )
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
        if (message.type === 'WORKBENCH_BRIDGE_COMMAND') {
          const allowed = new Set([
            'STATUS',
            'PAGE_STATUS',
            'LOCATE_JOB_PAGE',
            'READ',
            'SAVE',
            'BATCH_STATUS',
            'BATCH_START',
            'BATCH_PAUSE',
            'BATCH_RESUME',
            'BATCH_STOP',
          ]);
          if (!allowed.has(message.command?.type)) throw new Error('工作台不支持此扩展操作');
          if (!stored.connection || stored.connection.base !== bridgeBase)
            throw new Error('请先连接当前工作台');
          const connection = await status(true, [bridgeBase]);
          if (connection.state !== 'connected' || connection.connection?.base !== bridgeBase)
            throw new Error('当前工作台连接不可用');
          const input = message.command;
          return handleCommand(
            {
              type: input.type,
              tabId: input.tabId,
              platform: input.platform,
              purpose: input.purpose,
              maxJobs: input.maxJobs,
              maxPages: input.maxPages,
              autoPage: input.autoPage,
              observations: input.observations,
            },
            commandGeneration,
          );
        }
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
      return handleCommand(message, commandGeneration);
    })()
      .then(sendResponse)
      .catch((error) =>
        sendResponse(
          error instanceof PageSelectionError
            ? { error: error.message, code: error.code, choices: error.choices }
            : {
                error: errorText(error),
                ...(error instanceof PageReadError && error.diagnostics
                  ? { diagnostics: error.diagnostics }
                  : {}),
              },
        ),
      );
    return true;
  });
});
