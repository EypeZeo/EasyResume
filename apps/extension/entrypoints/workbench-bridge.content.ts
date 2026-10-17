import { browser } from 'wxt/browser';
import { localServer, RECRUITING_HOSTS } from '../lib/observe';
import { pairingInfo } from '../lib/connection';

const commandFields: Record<string, string[]> = {
  STATUS: [],
  PAGE_STATUS: ['platform', 'purpose', 'tabId'],
  LOCATE_JOB_PAGE: ['platform', 'purpose', 'tabId'],
  READ: ['platform', 'purpose', 'tabId'],
  SAVE: ['observations'],
  BATCH_STATUS: [],
  BATCH_START: ['platform', 'purpose', 'tabId', 'maxJobs', 'maxPages', 'autoPage'],
  BATCH_PAUSE: [],
  BATCH_RESUME: ['platform', 'purpose', 'tabId'],
  BATCH_STOP: [],
};
const modifyingCommands = new Set([
  'READ',
  'SAVE',
  'BATCH_START',
  'BATCH_RESUME',
  'LOCATE_JOB_PAGE',
]);

function pageCommand(input: Record<string, unknown>): Record<string, unknown> {
  const type = typeof input.type === 'string' ? input.type : '';
  const fields = commandFields[type];
  if (!fields || Object.keys(input).some((key) => !['request_id', 'type', ...fields].includes(key)))
    throw new Error('不支持此浏览器操作或参数');
  const command: Record<string, unknown> = { type };
  for (const key of ['platform', 'purpose', 'tabId']) {
    if (input[key] === undefined) continue;
    const value = input[key];
    if (
      (key === 'platform' && !['boss', 'zhilian'].includes(value as string)) ||
      (key === 'purpose' && !['current', 'batch'].includes(value as string)) ||
      (key === 'tabId' && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0))
    )
      throw new Error('职位页面参数无效');
    command[key] = value;
  }
  if (type === 'BATCH_START') {
    for (const [key, maximum, fallback] of [
      ['maxJobs', 100, 20],
      ['maxPages', 5, 1],
    ] as const) {
      const value = input[key] ?? fallback;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maximum)
        throw new Error('批量读取范围无效');
      command[key] = value;
    }
    if (input.autoPage !== undefined && typeof input.autoPage !== 'boolean')
      throw new Error('自动翻页设置无效');
    command.autoPage = input.autoPage === true;
  }
  if (type === 'SAVE') {
    if (
      !Array.isArray(input.observations) ||
      !input.observations.length ||
      input.observations.length > 20
    )
      throw new Error('一次只能保存 1 到 20 条已读取岗位');
    command.observations = input.observations.map((item) => {
      if (!item || typeof item !== 'object' || item.protocol !== 1) throw new Error('岗位数据无效');
      const observation: Record<string, unknown> = { protocol: 1 };
      for (const [key, limit] of [
        ['url', 2000],
        ['title', 500],
        ['company', 500],
        ['text', 100000],
        ['platform_job_id', 500],
        ['city', 200],
      ] as const) {
        if (typeof item[key] !== 'string' || item[key].length > limit)
          throw new Error('岗位字段无效');
        observation[key] = item[key];
      }
      const url = new URL(item.url);
      if (
        url.protocol !== 'https:' ||
        !RECRUITING_HOSTS.includes(url.hostname) ||
        url.username ||
        url.password
      )
        throw new Error('仅保存招聘平台岗位');
      for (const [key, values] of [
        ['page_kind', ['list', 'detail', 'unknown']],
        ['employment_type', ['full_time', 'internship', 'part_time', 'unknown']],
        ['recruitment_type', ['campus', 'social', 'unknown']],
      ] as const) {
        if (!values.includes(item[key] as never)) throw new Error('岗位类型无效');
        observation[key] = item[key];
      }
      if (typeof item.blocked !== 'boolean') throw new Error('岗位状态无效');
      observation.blocked = item.blocked;
      return observation;
    });
  }
  return command;
}

/** Defense in depth: page results contain public state, never stored pairing material. */
function publicResult(input: unknown): unknown {
  const serialized = JSON.stringify(input ?? { error: '扩展没有返回结果' });
  if (serialized.length > 2200000) throw new Error('返回内容过大，请减少读取数量');
  return JSON.parse(serialized, (key, value) =>
    /^(?:token|digest|proof|challenge|authorization|secret|credentials?|pairing_code|connection_code|private_key|api_key)$/i.test(
      key,
    )
      ? undefined
      : value,
  );
}

/** Pairing offers and bounded read-only commands cross this page boundary; never a stored token. */
export default defineContentScript({
  matches: ['http://127.0.0.1/*'],
  runAt: 'document_idle',
  main(ctx) {
    let pending: Promise<boolean> | undefined;
    let requestId = '';
    let expires = 0;
    let finished = false;
    let completeOffer: ((connected: boolean) => void) | undefined;
    const commands = new Map<string, { fingerprint: string; passive: boolean; result?: unknown }>();
    let inFlight = 0;
    let modifying = false;

    ctx.addEventListener(window, 'easyresume:browser-command', (event) => {
      if (!['/', '/index.html'].includes(location.pathname)) return;
      const detail = (event as CustomEvent).detail;
      const id = detail?.request_id;
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) return;
      const respond = (result: unknown) =>
        window.dispatchEvent(
          new CustomEvent('easyresume:browser-result', { detail: { request_id: id, result } }),
        );
      let command: Record<string, unknown>;
      try {
        command = pageCommand(detail);
      } catch (error) {
        respond({ error: error instanceof Error ? error.message : '浏览器操作无效' });
        return;
      }
      const fingerprint = JSON.stringify(command);
      const previous = commands.get(id);
      if (previous) {
        if (previous.fingerprint !== fingerprint) respond({ error: '请求编号已用于其他操作' });
        else if (previous.result !== undefined) respond(previous.result);
        return;
      }
      const changesPage = modifyingCommands.has(command.type as string);
      if (inFlight >= 4 || (changesPage && modifying)) {
        respond({ error: '上一项浏览器操作尚未完成，请稍候' });
        return;
      }
      // Polling must not exhaust replay storage. Keep all state-changing nonces for this page.
      if (commands.size >= 256)
        for (const [key, previous] of commands) {
          if (previous.passive && previous.result !== undefined) commands.delete(key);
          if (commands.size < 256) break;
        }
      // Never evict a still-running or state-changing request.
      if (commands.size >= 256) {
        respond({ error: '本页操作较多，请刷新工作台后继续' });
        return;
      }
      const entry = {
        fingerprint,
        passive: ['STATUS', 'PAGE_STATUS', 'BATCH_STATUS'].includes(command.type as string),
        result: undefined as unknown,
      };
      commands.set(id, entry);
      inFlight++;
      if (changesPage) modifying = true;
      let settled = false;
      const finish = (result: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        inFlight--;
        if (changesPage) modifying = false;
        try {
          entry.result = publicResult(result);
        } catch {
          entry.result = { error: '扩展返回内容无效，请检查任务状态' };
        }
        respond(entry.result);
      };
      const timer = ctx.setTimeout(
        () => finish({ error: '扩展尚未返回结果，请先检查任务状态再继续' }),
        20000,
      );
      void browser.runtime
        .sendMessage({ type: 'WORKBENCH_BRIDGE_COMMAND', command })
        .then(finish)
        .catch(() => finish({ error: '扩展连接不可用，请重新加载扩展并刷新工作台' }));
    });

    const requestOffer = () => {
      if (requestId && expires > Date.now())
        window.dispatchEvent(
          new CustomEvent('easyresume:extension-request', {
            detail: { request_id: requestId },
          }),
        );
    };
    const tryConnect = async (allowHidden = false): Promise<boolean> => {
      if (pending) {
        const connected = await pending;
        return connected || !allowHidden ? connected : tryConnect(true);
      }
      if (finished) return true;
      if (!allowHidden && document.visibilityState === 'hidden') return false;
      pending = (async () => {
        const base = localServer(location.origin);
        const response = await fetch(`${base}/api/v1/health`, {
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(2000),
        });
        if (!response.ok) return false;
        const health = await response.json();
        if (health.name !== 'EasyResume' || health.protocol !== 1) return false;
        const status = await browser.runtime.sendMessage({ type: 'WORKBENCH_BRIDGE_STATUS', base });
        if (status?.connected) {
          finished = true;
          return true;
        }
        // Explicit disconnect / revoked pairings stay disconnected until user reconnects.
        if (!status?.needs_pairing) return false;
        return new Promise<boolean>((resolve) => {
          requestId = crypto.randomUUID();
          expires = Date.now() + 12000;
          const timer = ctx.setTimeout(() => completeOffer?.(false), 12000);
          const complete = (connected: boolean) => {
            if (completeOffer !== complete) return;
            clearTimeout(timer);
            requestId = '';
            expires = 0;
            completeOffer = undefined;
            resolve(connected);
          };
          completeOffer = complete;
          requestOffer();
        });
      })()
        // Opening another local application must not show errors or trigger pairing.
        .catch(() => false)
        .finally(() => {
          pending = undefined;
        });
      return pending;
    };

    ctx.addEventListener(window, 'easyresume:extension-offer', (event) => {
      const detail = (event as CustomEvent).detail;
      if (finished || !requestId || expires <= Date.now() || detail?.request_id !== requestId)
        return;
      let input: string;
      try {
        if (typeof detail.info !== 'string' || detail.info.length > 2000) return;
        const info = pairingInfo(detail.info);
        if (info.base !== location.origin) return;
        input = detail.info;
      } catch {
        return;
      }
      requestId = '';
      const complete = completeOffer;
      void browser.runtime
        .sendMessage({ type: 'WORKBENCH_BRIDGE_PAIR', info: input })
        .then((result) => {
          if (result?.connected) {
            finished = true;
            window.dispatchEvent(new CustomEvent('easyresume:extension-connected'));
          }
          complete?.(result?.connected === true);
        })
        .catch(() => complete?.(false));
    });
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (
        message?.type !== 'WORKBENCH_RECONNECT' ||
        sender.id !== browser.runtime.id ||
        !sender.url?.startsWith(`chrome-extension://${browser.runtime.id}/`)
      )
        return;
      finished = false;
      // This message follows the user's Connect action; it may reach an inactive workbench tab.
      // Wait for the actual pairing, not only the page event that starts it.
      void tryConnect(true).then((connected) => sendResponse({ connected }));
      return true;
    });
    ctx.addEventListener(window, 'easyresume:workbench-ready', () => {
      if (requestId) requestOffer();
      else void tryConnect();
    });
    ctx.addEventListener(document, 'visibilitychange', () => void tryConnect());
    ctx.addEventListener(window, 'focus', () => void tryConnect());
    void tryConnect();
    for (const delay of [1000, 3000, 10000]) ctx.setTimeout(() => void tryConnect(), delay);
  },
});
