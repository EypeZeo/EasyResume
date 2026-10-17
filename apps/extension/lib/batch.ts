import type { Observation } from './observe';

export type BatchTarget = {
  key: string;
  title: string;
  company?: string;
  platform_job_id?: string;
  element: HTMLElement;
};

export type BatchAdapter = {
  observe(document: Document, href: string): Observation[];
  listTargets(document: Document, href: string): BatchTarget[];
  nextPageTarget(document: Document, href: string): HTMLElement | undefined;
  loadMoreTarget?(document: Document, href: string): HTMLElement | undefined;
  listExhausted?(document: Document, href: string): boolean;
};

export type BatchSnapshot = {
  taskId: string;
  documentId: string;
  href: string;
  pageKey: string;
  pageNumber: number;
  completed: number;
  targets: { key: string; title: string; company?: string }[];
  canNextPage: boolean;
  endOfList?: boolean;
};

export type BatchStep = {
  taskId: string;
  documentId: string;
  pageKey: string;
  kind: 'job' | 'next_page';
  targetKey?: string;
};

type Session = {
  id: string;
  href: string;
  pageNumber: number;
  completed: Set<string>;
  maxItems: number;
  maxPages: number;
  allowNextPage: boolean;
  abort: AbortController;
  reason: string;
};

const INTERVAL_MS = 3000;
const TIMEOUT_MS = 15000;
const STABLE_MS = 1000;
const DANGEROUS_ACTION =
  /^(立即沟通|立即投递|投递简历|申请职位|发送|发送简历|收藏|取消收藏|打招呼|申请|沟通|登录|注册)$/;
const normalize = (value: string) => value.replace(/[\s\u200b-\u200d\ufeff]+/g, '').trim();

function visible(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.opacity === '0')
      return false;
  }
  return true;
}

function selected(element: Element): boolean | undefined {
  if (
    element.matches(
      '[aria-selected="true"], [aria-current="true"], .active, .selected, .is-active, .is-selected, .job-card--active, .job-card-active',
    ) ||
    element.querySelector('[aria-selected="true"], [aria-current="true"]')
  )
    return true;
  if (element.matches('[aria-selected="false"], [aria-current="false"]')) return false;
  return undefined;
}

function stableId(value: string): string {
  return (
    value.match(/\/job_detail\/([^/.?#]+)/)?.[1] ??
    value.match(/jobs\.zhaopin\.com\/([^/?#]+)\.htm[l]?/)?.[1] ??
    ''
  );
}

/** Runs exactly one bounded DOM interaction. The background owns the loop and persistence. */
export function createBatchReader(document: Document, href: () => string, adapter: BatchAdapter) {
  const documentId = crypto.randomUUID();
  let session: Session | undefined;
  let busy = false;
  let lastClick = -Infinity;

  const cancel = (reason = '已暂停批量读取') => {
    if (!session) return;
    session.reason = reason;
    session.abort.abort();
  };
  const userInteraction = (event: Event) => {
    if (event.isTrusted) cancel('你操作了招聘页面，批量读取已暂停');
  };
  document.addEventListener('pointerdown', userInteraction, true);
  document.addEventListener('click', userInteraction, true);
  document.addEventListener('keydown', userInteraction, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') cancel('招聘页面已切到后台，批量读取已暂停');
  });
  for (const event of ['pagehide', 'popstate', 'hashchange'])
    document.defaultView?.addEventListener(event, () => cancel('页面已切换，批量读取已暂停'));

  function safety(current: Session, allowPageQueryChange = false): void {
    if (current.abort.signal.aborted) throw new Error(current.reason);
    if (document.visibilityState !== 'visible') throw new Error('请保持招聘页面在前台');
    const url = new URL(href());
    const expected = new URL(current.href);
    const boss = ['www.zhipin.com', 'zhipin.com'].includes(url.hostname);
    const zhilian = ['www.zhaopin.com', 'sou.zhaopin.com', 'jobs.zhaopin.com'].includes(
      url.hostname,
    );
    if (
      url.protocol !== 'https:' ||
      (!boss && !zhilian) ||
      /\/chat(?:\/|$)|\/passport(?:\/|$)|\/user(?:\/|$)|\/login(?:\/|$)|\/resume(?:\/|$)/i.test(
        url.pathname,
      )
    )
      throw new Error('已离开支持的职位页面，批量读取已暂停');
    if (
      url.origin !== expected.origin ||
      url.pathname !== expected.pathname ||
      (!allowPageQueryChange && url.href !== expected.href)
    )
      throw new Error('页面地址已变化，请重新开始批量读取');
    const challenge = Array.from(
      document.querySelectorAll(
        '[class*="captcha"], #captcha, [class*="geetest"], .verify-page, .error-page, [role="alert"]',
      ),
    ).some(
      (element) =>
        visible(element) &&
        (/captcha|geetest/.test(element.className + element.id)
          ? !!element.textContent?.trim() || !!element.querySelector('iframe, canvas, input, img')
          : /请完成验证|安全验证|访问异常|账号异常|操作频繁|稍后再试/.test(
              element.textContent ?? '',
            )),
    );
    if (challenge || /安全验证|访问异常|账号异常/.test(document.title))
      throw new Error('检测到验证或异常，批量读取已暂停；请处理后重新开始');
  }

  function targets(): BatchTarget[] {
    const values = adapter
      .listTargets(document, href())
      .filter(
        (target) =>
          !!target.key && !!target.title && target.element.isConnected && visible(target.element),
      );
    const keys = new Set<string>();
    for (const target of values) {
      if (keys.has(target.key)) throw new Error('列表中存在无法区分的岗位，请手动读取');
      keys.add(target.key);
    }
    return values.slice(0, 100);
  }

  function pageKey(values: BatchTarget[]): string {
    // This fingerprint carries no page text or credentials and is scoped to this document.
    let hash = 2166136261;
    for (const character of values.map((target) => target.key).join('\n'))
      hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return `${values.length}:${(hash >>> 0).toString(16)}`;
  }

  function snapshot(current: Session): BatchSnapshot {
    const values = targets();
    const endOfList = adapter.listExhausted?.(document, href()) === true;
    return {
      taskId: current.id,
      documentId,
      href: href(),
      pageKey: pageKey(values),
      pageNumber: current.pageNumber,
      completed: current.completed.size,
      targets: values.map(({ key, title, company }) => ({ key, title, company })),
      endOfList,
      canNextPage:
        current.allowNextPage &&
        current.pageNumber < current.maxPages &&
        !endOfList &&
        (!!adapter.nextPageTarget(document, href()) ||
          !!adapter.loadMoreTarget?.(document, href())),
    };
  }

  function prepare(
    taskId: string,
    options?: { maxItems?: number; maxPages?: number; allowNextPage?: boolean },
  ): BatchSnapshot {
    if (busy) throw new Error('上一步仍在停止，请稍后再开始');
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(taskId)) throw new Error('批量任务标识无效');
    cancel();
    const maxItems = options?.maxItems ?? 20;
    const maxPages = options?.maxPages ?? 2;
    if (
      !Number.isInteger(maxItems) ||
      maxItems < 1 ||
      maxItems > 100 ||
      !Number.isInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 5
    )
      throw new Error('批量读取范围无效');
    const current: Session = {
      id: taskId,
      href: href(),
      pageNumber: 1,
      completed: new Set(),
      maxItems,
      maxPages,
      allowNextPage: options?.allowNextPage === true,
      abort: new AbortController(),
      reason: '',
    };
    safety(current);
    const result = snapshot(current);
    if (!result.targets.length) throw new Error('当前页没有支持的职位列表，请打开招聘列表后重试');
    session = current;
    return result;
  }

  function sleep(ms: number, current: Session): Promise<void> {
    if (ms <= 0)
      return current.abort.signal.aborted
        ? Promise.reject(new Error(current.reason))
        : Promise.resolve();
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error(current.reason));
      };
      const timer = setTimeout(() => {
        current.abort.signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      if (current.abort.signal.aborted) {
        onAbort();
        return;
      }
      current.abort.signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  function safeClick(element: HTMLElement, pagination: boolean): void {
    if (
      !element.isConnected ||
      !visible(element) ||
      element.matches('[disabled], [aria-disabled="true"], .disabled, .is-disabled') ||
      DANGEROUS_ACTION.test(
        normalize(element.getAttribute('aria-label') ?? element.textContent ?? ''),
      ) ||
      element.matches('input, textarea, select, button[type="submit"]') ||
      element.closest('form')
    )
      throw new Error('无法安全打开该岗位或下一页，请手动处理');
    if (pagination) {
      const label =
        normalize(element.textContent ?? '') + normalize(element.getAttribute('aria-label') ?? '');
      if (!/下一页|下页|加载更多|更多职位|next/i.test(label + element.className))
        throw new Error('未识别可安全使用的下一页按钮');
    }
    const anchor = element.closest<HTMLAnchorElement>('a[href]');
    if (anchor) {
      const url = new URL(anchor.getAttribute('href')!, href());
      if (
        url.origin !== new URL(href()).origin ||
        /chat|apply|deliver|favorite|resume|login|passport/i.test(url.pathname)
      )
        throw new Error('跳转目标不属于只读职位操作');
      if (anchor.target === '_blank') throw new Error('此岗位会打开新标签页，请手动打开后读取');
    }
    element.click();
    lastClick = Date.now();
  }

  function safeLoadMore(element: HTMLElement, before: BatchTarget[]): void {
    const url = new URL(href());
    const bossPanels = Array.from(
      document.querySelectorAll('.job-list-container > ul.rec-job-list'),
    ).filter((panel) => visible(panel) && !panel.closest('.job-detail-container'));
    const bossList = element.parentElement;
    const bossAllowed =
      ['www.zhipin.com', 'zhipin.com'].includes(url.hostname) &&
      element.matches('li.job-card-box') &&
      bossPanels.length === 1 &&
      bossList === bossPanels[0] &&
      Array.from(bossList.querySelectorAll(':scope > li.job-card-box')).filter(visible).at(-1) ===
        element;
    const zhilianAllowed =
      ['www.zhaopin.com', 'sou.zhaopin.com', 'jobs.zhaopin.com'].includes(url.hostname) &&
      element.matches('.job-card') &&
      !!element.closest('.job-split-layout__left .job-list-panel');
    if (
      (!bossAllowed && !zhilianAllowed) ||
      !element.isConnected ||
      !visible(element) ||
      before.at(-1)?.element !== element
    )
      throw new Error('未识别可安全滚动的职位列表，请手动加载更多');
    // Only the verified list's final card is scrolled. Never click a card to load more.
    element.scrollIntoView({ block: bossAllowed ? 'start' : 'end', behavior: 'auto' });
    lastClick = Date.now();
  }

  function detail(target: BatchTarget, values: BatchTarget[]): Observation | undefined {
    const observations = adapter
      .observe(document, href())
      .filter((item) => item.page_kind === 'detail');
    if (observations.length !== 1) return;
    const observation = observations[0];
    if (observation.blocked) throw new Error('当前职位处于验证或异常状态');
    if (normalize(observation.title) !== normalize(target.title)) return;
    if (target.company && normalize(observation.company) !== normalize(target.company)) return;
    const targetId = target.platform_job_id || stableId(target.key);
    const observationId = observation.platform_job_id || stableId(observation.url);
    if (targetId && observationId) {
      if (targetId !== observationId) return;
    } else {
      if (!target.company || !observation.company) return;
      const duplicates = values.filter(
        (item) =>
          normalize(item.title) === normalize(target.title) &&
          normalize(item.company ?? '') === normalize(target.company ?? ''),
      );
      if (duplicates.length !== 1) return;
    }
    const liveTarget = values.find((item) => item.key === target.key);
    if (!liveTarget || selected(liveTarget.element) === false) return;
    return observation;
  }

  async function step(
    command: BatchStep,
  ): Promise<BatchSnapshot & { observation?: Observation; done?: boolean }> {
    const current = session;
    if (!current || current.id !== command.taskId || command.documentId !== documentId)
      throw new Error('批量任务已失效，请重新开始');
    if (busy) throw new Error('已有读取步骤正在执行');
    safety(current);
    if (snapshot(current).pageKey !== command.pageKey)
      throw new Error('职位列表已变化，请重新开始');
    if (current.completed.size >= current.maxItems) return { ...snapshot(current), done: true };
    busy = true;
    try {
      await sleep(Math.max(0, INTERVAL_MS - (Date.now() - lastClick)), current);
      safety(current);
      if (snapshot(current).pageKey !== command.pageKey)
        throw new Error('职位列表已变化，请重新开始');
      const before = targets();
      let expected: BatchTarget | undefined;
      if (command.kind === 'job') {
        expected = before.find((target) => target.key === command.targetKey);
        if (!expected) throw new Error('所选岗位已不在当前列表，请重新开始');
        if (current.completed.has(expected.key)) throw new Error('该岗位已读取，不会再次点击');
      } else if (command.kind !== 'next_page') throw new Error('不支持的批量步骤');
      if (
        command.kind === 'next_page' &&
        (!current.allowNextPage || current.pageNumber >= current.maxPages)
      )
        return { ...snapshot(current), done: true };
      const pagination = expected ? undefined : adapter.nextPageTarget(document, href());
      const loadMore =
        expected || pagination ? undefined : adapter.loadMoreTarget?.(document, href());
      const element = expected?.element ?? pagination ?? loadMore;
      if (!element) return { ...snapshot(current), done: true };
      // A previously selected card can be read without clicking it again; a new selection must settle.
      let baseline: string | undefined = '';
      if (expected) {
        try {
          baseline = JSON.stringify(detail(expected, before));
        } catch {
          /* detail still loading */
        }
      }
      const alreadySelected =
        expected &&
        baseline !== undefined &&
        baseline !== '' &&
        (selected(expected.element) === true ||
          (!!(expected.platform_job_id || stableId(expected.key)) &&
            JSON.parse(baseline).platform_job_id ===
              (expected.platform_job_id || stableId(expected.key))));
      if (loadMore) safeLoadMore(loadMore, before);
      else if (!alreadySelected) safeClick(element, command.kind === 'next_page');
      const started = Date.now();
      let lastValue = '';
      let stableSince = started;
      let endedSince: number | undefined;
      let lastError = '';
      while (Date.now() - started < TIMEOUT_MS) {
        await sleep(200, current);
        safety(current, command.kind === 'next_page');
        const live = targets();
        if (command.kind === 'next_page') {
          const fingerprint = pageKey(live);
          const appended =
            live.length > before.length &&
            before.every((old) => live.some((item) => item.key === old.key));
          if (
            loadMore &&
            fingerprint === command.pageKey &&
            adapter.listExhausted?.(document, href()) === true
          ) {
            endedSince ??= Date.now();
            if (Date.now() - endedSince >= STABLE_MS) return { ...snapshot(current), done: true };
          } else endedSince = undefined;
          if (!live.length || fingerprint === command.pageKey || (loadMore && !appended)) {
            stableSince = Date.now();
            continue;
          }
          if (fingerprint !== lastValue) {
            lastValue = fingerprint;
            stableSince = Date.now();
          }
          if (Date.now() - stableSince >= STABLE_MS && Date.now() - started >= INTERVAL_MS) {
            current.href = href();
            current.pageNumber++;
            return snapshot(current);
          }
          continue;
        }
        if (pageKey(live) !== command.pageKey)
          throw new Error('读取期间职位列表发生变化，请重新开始');
        let observation: Observation | undefined;
        try {
          observation = detail(expected!, live);
        } catch (error) {
          lastError = error instanceof Error ? error.message : '';
        }
        if (!observation) {
          stableSince = Date.now();
          lastValue = '';
          continue;
        }
        const value = JSON.stringify(observation);
        if (!alreadySelected && value === baseline) {
          stableSince = Date.now();
          continue;
        }
        if (value !== lastValue) {
          lastValue = value;
          stableSince = Date.now();
        }
        if (Date.now() - stableSince >= STABLE_MS && Date.now() - started >= INTERVAL_MS) {
          safety(current);
          current.completed.add(expected!.key);
          return {
            ...snapshot(current),
            observation,
            done: current.completed.size >= current.maxItems,
          };
        }
      }
      throw new Error(
        loadMore
          ? '等待新增职位超时，已暂停；已经保存的职位会保留，可手动加载后继续'
          : `等待职位详情稳定超时，已暂停，未导入本条${lastError ? `：${lastError}` : ''}`,
      );
    } catch (error) {
      cancel(error instanceof Error ? error.message : '读取失败，已暂停');
      throw error;
    } finally {
      busy = false;
    }
  }

  return {
    prepare,
    step,
    stop(taskId: string) {
      if (session?.id === taskId) cancel();
      return { stopped: session?.id === taskId };
    },
  };
}
