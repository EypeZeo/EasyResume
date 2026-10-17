// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBatchReader, type BatchAdapter, type BatchSnapshot } from './batch';
import { listExhausted, loadMoreTarget, type Observation } from './observe';

const url = 'https://www.zhipin.com/web/geek/job-recommend';
let href = url;

function fixture() {
  document.title = '合成岗位列表';
  document.body.innerHTML = `
    <div id="cards">
      <div class="card" data-key="a"><span class="title">Linux 运维</span><span class="company">合成甲公司</span></div>
      <div class="card" data-key="b"><span class="title">数据库运维</span><span class="company">合成乙公司</span></div>
    </div>
    <section id="detail" data-id="old"><h1>之前的职位</h1><p class="company">之前的公司</p><p class="description">旧描述不能混入新职位</p></section>
    <button class="next">下一页</button>`;
  const adapter: BatchAdapter = {
    listTargets: () =>
      Array.from(document.querySelectorAll<HTMLElement>('.card')).map((element) => ({
        key: element.dataset.key!,
        title: element.querySelector('.title')!.textContent!,
        company: element.querySelector('.company')!.textContent!,
        platform_job_id: element.dataset.key,
        element,
      })),
    observe: () => {
      const root = document.querySelector('#detail')!;
      return [
        {
          protocol: 1,
          url,
          title: root.querySelector('h1')!.textContent!,
          company: root.querySelector('.company')!.textContent!,
          text: root.querySelector('.description')!.textContent!,
          platform_job_id: root.getAttribute('data-id')!,
          city: '',
          page_kind: 'detail',
          employment_type: 'unknown',
          recruitment_type: 'unknown',
          blocked: false,
        } as Observation,
      ];
    },
    nextPageTarget: () => document.querySelector<HTMLButtonElement>('.next') ?? undefined,
  };
  let clicks = 0;
  for (const card of document.querySelectorAll<HTMLElement>('.card')) {
    card.addEventListener('click', () => {
      clicks++;
      document.querySelector('.card.active')?.classList.remove('active');
      card.classList.add('active');
      const root = document.querySelector('#detail')!;
      root.setAttribute('data-id', card.dataset.key!);
      root.querySelector('h1')!.textContent = card.querySelector('.title')!.textContent;
      root.querySelector('.company')!.textContent = card.querySelector('.company')!.textContent;
      setTimeout(() => {
        root.querySelector('.description')!.textContent = `完整描述 ${card.dataset.key}`;
      }, 800);
    });
  }
  const reader = createBatchReader(document, () => href, adapter);
  return { reader, adapter, clicks: () => clicks };
}

function job(snapshot: BatchSnapshot, key = 'a') {
  return { ...snapshot, kind: 'job' as const, targetKey: key };
}

function scrollingFixture() {
  const test = fixture();
  href = 'https://www.zhaopin.com/jobs/recommend';
  const panel = document.querySelector<HTMLElement>('#cards')!;
  const column = document.createElement('aside');
  column.className = 'job-split-layout__left';
  panel.parentElement!.insertBefore(column, panel);
  column.append(panel);
  panel.className = 'job-list-panel';
  for (const card of panel.querySelectorAll('.card')) card.classList.add('job-card');
  document.querySelector('.next')!.remove();
  test.adapter.loadMoreTarget = () =>
    panel.querySelector<HTMLElement>('.card:last-child') ?? undefined;
  const last = panel.querySelector<HTMLElement>('.card:last-child')!;
  const scroll = vi.fn();
  last.scrollIntoView = scroll;
  return { ...test, panel, scroll };
}

function bossScrollingFixture() {
  const test = fixture();
  const old = document.querySelector<HTMLElement>('#cards')!;
  const container = document.createElement('div');
  container.className = 'job-list-container';
  const panel = document.createElement('ul');
  panel.className = 'rec-job-list';
  const click = vi.fn();
  for (const source of old.querySelectorAll<HTMLElement>('.card')) {
    const card = document.createElement('li');
    card.className = 'card job-card-box';
    card.dataset.key = source.dataset.key;
    card.innerHTML = source.innerHTML;
    card.addEventListener('click', click);
    panel.append(card);
  }
  container.append(panel);
  const loading = document.createElement('div');
  loading.className = 'loading-wait';
  container.append(loading);
  old.replaceWith(container);
  document.querySelector('.next')!.remove();
  test.adapter.loadMoreTarget = loadMoreTarget;
  test.adapter.listExhausted = listExhausted;
  const last = panel.lastElementChild as HTMLElement;
  const scroll = vi.fn();
  last.scrollIntoView = scroll;
  return { ...test, panel, container, loading, scroll, click };
}

function emptyZhilianFixture() {
  const test = scrollingFixture();
  const module = document.createElement('section');
  module.className = 'job-detail-modules';
  document.body.append(module);
  let completeKey = '';
  let onClick: (key: string, count: number) => void = () => {};
  let clickCount = 0;
  const clickTimes: number[] = [];
  for (const card of test.panel.querySelectorAll<HTMLElement>('.card')) {
    card.addEventListener('click', () => {
      clickCount++;
      clickTimes.push(Date.now());
      completeKey = '';
      module.replaceChildren();
      onClick(card.dataset.key!, clickCount);
    });
  }
  test.adapter.observe = () => {
    if (!completeKey) return [];
    const card = test.panel.querySelector<HTMLElement>(`[data-key="${completeKey}"]`)!;
    return [
      {
        protocol: 1,
        url: href,
        title: card.querySelector('.title')!.textContent!,
        company: card.querySelector('.company')!.textContent!,
        text: `完整智联描述 ${completeKey}`,
        platform_job_id: completeKey,
        city: '',
        page_kind: 'detail',
        employment_type: 'unknown',
        recruitment_type: 'unknown',
        blocked: false,
      },
    ];
  };
  return {
    ...test,
    module,
    clickCount: () => clickCount,
    clickTimes,
    onClick(callback: typeof onClick) {
      onClick = callback;
    },
    complete(key: string) {
      completeKey = key;
      module.innerHTML = '<p>已加载的完整职位内容</p>';
    },
  };
}

function districtIdentityFixture(
  first = '郑州 金水 杜岭',
  second = '郑州 管城 金岱',
  right = '郑州·金水区·陈庄',
) {
  href = 'https://www.zhaopin.com/jobs/?pageMode=search';
  document.title = '合成智联职位';
  document.body.innerHTML = `<aside class="job-split-layout__left"><div class="job-list-panel">
    <article class="job-card job-card--active"><span class="job-card__title-clamp">运维工程师双休</span><span class="job-card__company-name">合成瑞子公司</span><span class="job-card__location"></span></article>
    <article class="job-card"><span class="job-card__title-clamp">运维工程师双休</span><span class="job-card__company-name">合成瑞子公司</span><span class="job-card__location"></span></article>
  </div></aside><section class="job-detail-modules"><h1 class="job-detail-summary__title-text">运维工程师双休</h1><span class="job-detail-summary__company-name">合成瑞子公司</span><span class="job-detail-summary__tag"></span><div class="job-description__content">完整的合成运维职责</div><a href="https://www.zhaopin.com/jobdetail/RIGHT_A.htm">查看更多职位信息</a></section>`;
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.job-card'));
  cards[0].querySelector('.job-card__location')!.textContent = first;
  cards[1].querySelector('.job-card__location')!.textContent = second;
  const root = document.querySelector<HTMLElement>('.job-detail-modules')!;
  root.querySelector('.job-detail-summary__tag')!.textContent = right;
  const click = vi.fn();
  for (const card of cards)
    card.addEventListener('click', () => {
      click();
      cards.forEach((item) => item.classList.toggle('job-card--active', item === card));
    });
  const adapter: BatchAdapter = {
    listTargets: () =>
      Array.from(document.querySelectorAll<HTMLElement>('.job-card')).map((element) => ({
        key: `运维工程师双休\u001f合成瑞子公司\u001f${element.querySelector('.job-card__location')!.textContent}`,
        title: '运维工程师双休',
        company: '合成瑞子公司',
        platform_job_id: element.dataset.id ?? '',
        element,
      })),
    observe: () => [
      {
        protocol: 1,
        url: 'https://www.zhaopin.com/jobdetail/RIGHT_A.htm',
        title: '运维工程师双休',
        company: '合成瑞子公司',
        text: right + '\n完整的合成运维职责',
        platform_job_id: 'RIGHT_A',
        city: '郑州',
        page_kind: 'detail',
        employment_type: 'unknown',
        recruitment_type: 'unknown',
        blocked: false,
      },
    ],
    nextPageTarget: () => undefined,
  };
  return { reader: createBatchReader(document, () => href, adapter), adapter, root, cards, click };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-17T04:00:00Z'));
  href = url;
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});
afterEach(() => vi.useRealTimers());

describe('bounded readonly batch steps on synthetic DOM', () => {
  it('reads an already open exact job ID without clicking an unmarked card again', async () => {
    const test = fixture();
    const root = document.querySelector('#detail')!;
    root.setAttribute('data-id', 'a');
    root.querySelector('h1')!.textContent = 'Linux 运维';
    root.querySelector('.company')!.textContent = '合成甲公司';
    root.querySelector('.description')!.textContent = '已打开且可核对的完整描述';
    const snapshot = test.reader.prepare('task');
    const promise = test.reader.step(job(snapshot));
    await vi.advanceTimersByTimeAsync(3200);
    expect((await promise).observation?.platform_job_id).toBe('a');
    expect(test.clicks()).toBe(0);
  });
  it('prepare never clicks; a job waits for the matching complete detail to settle', async () => {
    const test = fixture();
    const snapshot = test.reader.prepare('task');
    expect(test.clicks()).toBe(0);
    const promise = test.reader.step(job(snapshot));
    await vi.advanceTimersByTimeAsync(1600);
    expect(test.clicks()).toBe(1);
    await vi.advanceTimersByTimeAsync(1600);
    const result = await promise;
    expect(result.observation?.text).toBe('完整描述 a');
    expect(result.observation?.company).toBe('合成甲公司');
    expect(result.completed).toBe(1);
    expect(JSON.stringify(result)).not.toContain('旧描述');
  });

  it('does not accept an old detail for a different company or a wrong platform id', async () => {
    const test = fixture();
    test.adapter.observe = () => [
      {
        title: 'Linux 运维',
        company: '合成甲公司',
        text: '内容',
        platform_job_id: 'different',
        page_kind: 'detail',
      } as Observation,
    ];
    const snapshot = test.reader.prepare('task');
    const rejection = expect(test.reader.step(job(snapshot))).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(15200);
    await rejection;
    expect(test.clicks()).toBe(1);
    await expect(test.reader.step(job(snapshot, 'b'))).rejects.toThrow('超时');
    expect(test.clicks()).toBe(1);
  });

  it('stopping aborts the pending wait; preparing again is an explicit restart', async () => {
    const test = fixture();
    const snapshot = test.reader.prepare('task');
    const rejection = expect(test.reader.step(job(snapshot))).rejects.toThrow('暂停');
    await vi.advanceTimersByTimeAsync(200);
    test.reader.stop('task');
    await rejection;
    const resumed = test.reader.prepare('new_task');
    expect(resumed.completed).toBe(0);
    const next = test.reader.step(job(resumed, 'b'));
    await vi.advanceTimersByTimeAsync(6000);
    expect((await next).observation?.platform_job_id).toBe('b');
    expect(test.clicks()).toBe(2);
  });

  it('permits only one in-flight step and never repeats a completed card', async () => {
    const test = fixture();
    const snapshot = test.reader.prepare('task');
    const pending = test.reader.step(job(snapshot));
    await expect(test.reader.step(job(snapshot, 'b'))).rejects.toThrow('正在执行');
    await vi.advanceTimersByTimeAsync(3200);
    const result = await pending;
    await expect(test.reader.step(job(result))).rejects.toThrow('已读取');
    expect(test.clicks()).toBe(1);
  });

  it('pauses when the page is hidden and does not click another card', async () => {
    const test = fixture();
    const snapshot = test.reader.prepare('task');
    const rejection = expect(test.reader.step(job(snapshot))).rejects.toThrow('后台');
    await vi.advanceTimersByTimeAsync(200);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await rejection;
    expect(test.clicks()).toBe(1);
  });

  it('pauses on a real user click but does not treat its own synthetic card click as user navigation', async () => {
    const test = fixture();
    const snapshot = test.reader.prepare('task');
    const rejection = expect(test.reader.step(job(snapshot))).rejects.toThrow('操作了');
    await vi.advanceTimersByTimeAsync(200);
    const click = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(click, 'isTrusted', { value: true });
    document.body.dispatchEvent(click);
    await rejection;
    expect(test.clicks()).toBe(1);
  });

  it('rejects stale document, navigation and changed list before clicking', async () => {
    const test = fixture();
    const snapshot = test.reader.prepare('task');
    await expect(test.reader.step({ ...job(snapshot), documentId: 'other' })).rejects.toThrow(
      '失效',
    );
    href = `${url}?query=changed`;
    await expect(test.reader.step(job(snapshot))).rejects.toThrow('地址');
    href = url;
    document.querySelector('.card')!.setAttribute('data-key', 'replacement');
    await expect(test.reader.step(job(snapshot))).rejects.toThrow('列表');
    expect(test.clicks()).toBe(0);
  });

  it('pauses on a visible challenge and leaves hidden inactive widgets alone', async () => {
    const test = fixture();
    document.body.insertAdjacentHTML('beforeend', '<div id="captcha" hidden>请完成验证</div>');
    const snapshot = test.reader.prepare('task');
    const rejection = expect(test.reader.step(job(snapshot))).rejects.toThrow('验证');
    await vi.advanceTimersByTimeAsync(200);
    document.querySelector('#captcha')!.removeAttribute('hidden');
    await vi.advanceTimersByTimeAsync(200);
    await rejection;
  });

  it('requires explicit pagination and waits for a changed list instead of reading the old page', async () => {
    const test = fixture();
    let pages = 0;
    document.querySelector('.next')!.addEventListener('click', () => {
      pages++;
      setTimeout(() => document.querySelector('.card')!.setAttribute('data-key', 'new_page'), 500);
    });
    const manual = test.reader.prepare('manual');
    expect((await test.reader.step({ ...manual, kind: 'next_page' })).done).toBe(true);
    expect(pages).toBe(0);
    const enabled = test.reader.prepare('pages', { allowNextPage: true });
    const pending = test.reader.step({ ...enabled, kind: 'next_page' });
    await vi.advanceTimersByTimeAsync(3200);
    const second = await pending;
    expect(pages).toBe(1);
    expect(second.pageNumber).toBe(2);
    expect(second.pageKey).not.toBe(enabled.pageKey);
    expect((await test.reader.step({ ...second, kind: 'next_page' })).done).toBe(true);
    expect(pages).toBe(1);
  });

  it('pauses when pagination leaves the previous list in place', async () => {
    const test = fixture();
    const snapshot = test.reader.prepare('task', { allowNextPage: true });
    const rejection = expect(test.reader.step({ ...snapshot, kind: 'next_page' })).rejects.toThrow(
      '超时',
    );
    await vi.advanceTimersByTimeAsync(15200);
    await rejection;
    expect(test.clicks()).toBe(0);
  });

  it('loads the verified Zhaopin list by scrolling its last card without clicking it', async () => {
    const test = scrollingFixture();
    test.scroll.mockImplementation(() =>
      setTimeout(() => {
        const card = test.panel.lastElementChild!.cloneNode(true) as HTMLElement;
        card.dataset.key = 'c';
        card.querySelector('.title')!.textContent = '新增合成岗位';
        test.panel.append(card);
      }, 600),
    );
    const manual = test.reader.prepare('manual');
    expect(manual.canNextPage).toBe(false);
    expect((await test.reader.step({ ...manual, kind: 'next_page' })).done).toBe(true);
    expect(test.scroll).not.toHaveBeenCalled();
    const snapshot = test.reader.prepare('scroll', { allowNextPage: true });
    expect(snapshot.canNextPage).toBe(true);
    const pending = test.reader.step({ ...snapshot, kind: 'next_page' });
    await vi.advanceTimersByTimeAsync(3200);
    const next = await pending;
    expect(test.scroll).toHaveBeenCalledOnce();
    expect(test.scroll).toHaveBeenCalledWith({ block: 'end', behavior: 'auto' });
    expect(next.targets).toHaveLength(3);
    expect(next.pageNumber).toBe(2);
    expect(next.canNextPage).toBe(false);
    expect(test.clicks()).toBe(0);
  });

  it('loads the observed BOSS left list by scrolling its final card and waits for appended identities', async () => {
    const test = bossScrollingFixture();
    test.scroll.mockImplementation(() =>
      setTimeout(() => {
        const card = test.panel.lastElementChild!.cloneNode(true) as HTMLElement;
        card.dataset.key = 'c';
        card.querySelector('.title')!.textContent = '新增合成 BOSS 岗位';
        test.panel.append(card);
      }, 600),
    );
    const manual = test.reader.prepare('manual');
    expect(manual.canNextPage).toBe(false);
    expect((await test.reader.step({ ...manual, kind: 'next_page' })).done).toBe(true);
    expect(test.scroll).not.toHaveBeenCalled();
    const snapshot = test.reader.prepare('boss_scroll', { allowNextPage: true, maxPages: 2 });
    expect(snapshot.canNextPage).toBe(true);
    const pending = test.reader.step({ ...snapshot, kind: 'next_page' });
    await vi.advanceTimersByTimeAsync(3200);
    const result = await pending;
    expect(test.scroll).toHaveBeenCalledOnce();
    expect(test.scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
    expect(result.targets).toHaveLength(3);
    expect(result.pageKey).not.toBe(snapshot.pageKey);
    expect(result.pageNumber).toBe(2);
    expect(result.canNextPage).toBe(false);
    expect(result.endOfList).toBe(false);
    expect(test.click).not.toHaveBeenCalled();
  });

  it('pauses BOSS scrolling when its empty loading placeholder produces no new jobs', async () => {
    const test = bossScrollingFixture();
    const snapshot = test.reader.prepare('boss_no_append', { allowNextPage: true });
    expect(snapshot.endOfList).toBe(false);
    const rejection = expect(test.reader.step({ ...snapshot, kind: 'next_page' })).rejects.toThrow(
      '新增职位超时',
    );
    await vi.advanceTimersByTimeAsync(15200);
    await rejection;
    expect(test.scroll).toHaveBeenCalledOnce();
    expect(test.click).not.toHaveBeenCalled();
    await expect(test.reader.step({ ...snapshot, kind: 'next_page' })).rejects.toThrow(
      '新增职位超时',
    );
    expect(test.scroll).toHaveBeenCalledOnce();
  });

  it('scrolls the real final BOSS card through the observed card-area and job-card-wrap layers', async () => {
    const test = bossScrollingFixture();
    for (const card of Array.from(test.panel.children)) {
      const area = document.createElement('div');
      area.className = 'card-area is-seen';
      const wrap = document.createElement('div');
      wrap.className = 'job-card-wrap';
      card.replaceWith(area);
      wrap.append(card);
      area.append(wrap);
    }
    const last = test.panel.querySelector<HTMLElement>('.card-area:last-child li.job-card-box')!;
    expect(test.panel.querySelectorAll(':scope > li.job-card-box')).toHaveLength(0);
    expect(test.panel.querySelectorAll('li.job-card-box')).toHaveLength(2);
    expect(loadMoreTarget(document, href)).toBe(last);
    test.scroll.mockImplementation(() =>
      setTimeout(() => {
        const area = test.panel.lastElementChild!.cloneNode(true) as HTMLElement;
        area.querySelector<HTMLElement>('li.job-card-box')!.dataset.key = 'c';
        test.panel.append(area);
      }, 600),
    );
    const snapshot = test.reader.prepare('boss_wrapped', { allowNextPage: true, maxPages: 2 });
    expect(snapshot.canNextPage).toBe(true);
    const pending = test.reader.step({ ...snapshot, kind: 'next_page' });
    await vi.advanceTimersByTimeAsync(3200);
    const result = await pending;
    expect(test.scroll).toHaveBeenCalledExactlyOnceWith({ block: 'start', behavior: 'auto' });
    expect(result.targets).toHaveLength(3);
    expect(result.pageNumber).toBe(2);
    expect(result.canNextPage).toBe(false);
    expect(result.endOfList).toBe(false);
    expect(test.click).not.toHaveBeenCalled();
  });

  it('does not select a nested job card or a card belonging to a nested recommendation list', () => {
    const test = bossScrollingFixture();
    const last = test.panel.lastElementChild as HTMLElement;
    const nestedCard = document.createElement('li');
    nestedCard.className = 'job-card-box';
    last.append(nestedCard);
    const nestedList = document.createElement('ul');
    nestedList.className = 'rec-job-list';
    nestedList.innerHTML = '<li class="job-card-box">嵌套推荐卡片</li>';
    test.panel.append(nestedList);
    expect(loadMoreTarget(document, href)).toBe(last);
  });

  it('never scrolls a BOSS card borrowed from the right detail even if an adapter returns it', async () => {
    const test = bossScrollingFixture();
    const right = document.createElement('section');
    right.className = 'job-detail-container';
    right.innerHTML =
      '<div class="job-list-container"><ul class="rec-job-list"><li class="job-card-box">详情内相似卡片</li></ul><div class="loading-wait"></div></div>';
    document.body.append(right);
    const wrong = right.querySelector<HTMLElement>('li')!;
    const scroll = vi.fn();
    wrong.scrollIntoView = scroll;
    expect(loadMoreTarget(document, href)).toBe(test.panel.lastElementChild);
    test.adapter.loadMoreTarget = () => wrong;
    test.adapter.listTargets = () => [{ key: 'wrong', title: '详情内相似卡片', element: wrong }];
    const snapshot = test.reader.prepare('boss_wrong_panel', { allowNextPage: true });
    await expect(test.reader.step({ ...snapshot, kind: 'next_page' })).rejects.toThrow('安全滚动');
    expect(scroll).not.toHaveBeenCalled();
  });

  it('scrolls only the verified BOSS final card when its transient loading placeholder is absent', async () => {
    const test = bossScrollingFixture();
    test.loading.remove();
    expect(loadMoreTarget(document, href)).toBe(test.panel.lastElementChild);
    test.scroll.mockImplementation(() =>
      setTimeout(() => {
        const card = test.panel.lastElementChild!.cloneNode(true) as HTMLElement;
        card.dataset.key = 'c';
        test.panel.append(card);
      }, 600),
    );
    const snapshot = test.reader.prepare('boss_transient_loader', { allowNextPage: true });
    expect(snapshot.canNextPage).toBe(true);
    const pending = test.reader.step({ ...snapshot, kind: 'next_page' });
    await vi.advanceTimersByTimeAsync(3200);
    const result = await pending;
    expect(result.targets).toHaveLength(3);
    expect(result.pageNumber).toBe(2);
    expect(result.endOfList).toBe(false);
    expect(test.scroll).toHaveBeenCalledExactlyOnceWith({ block: 'start', behavior: 'auto' });
    expect(test.click).not.toHaveBeenCalled();
  });

  it('does not invent a BOSS load-more target with ambiguous left lists', () => {
    const test = bossScrollingFixture();
    document.body.append(test.container.cloneNode(true));
    expect(loadMoreTarget(document, href)).toBeUndefined();
  });

  it('does not scroll BOSS after reaching the configured item limit', async () => {
    const test = bossScrollingFixture();
    const root = document.querySelector('#detail')!;
    root.setAttribute('data-id', 'a');
    root.querySelector('h1')!.textContent = 'Linux 运维';
    root.querySelector('.company')!.textContent = '合成甲公司';
    const snapshot = test.reader.prepare('boss_item_limit', { allowNextPage: true, maxItems: 1 });
    const pending = test.reader.step(job(snapshot));
    await vi.advanceTimersByTimeAsync(3200);
    const result = await pending;
    expect(result.done).toBe(true);
    expect((await test.reader.step({ ...result, kind: 'next_page' })).done).toBe(true);
    expect(test.scroll).not.toHaveBeenCalled();
    expect(test.click).not.toHaveBeenCalled();
  });

  it('pauses after one list scroll if no new cards appear', async () => {
    const test = scrollingFixture();
    const snapshot = test.reader.prepare('scroll', { allowNextPage: true });
    const rejection = expect(test.reader.step({ ...snapshot, kind: 'next_page' })).rejects.toThrow(
      '新增职位超时',
    );
    await vi.advanceTimersByTimeAsync(15200);
    await rejection;
    expect(test.scroll).toHaveBeenCalledOnce();
    expect(test.clicks()).toBe(0);
    await expect(test.reader.step(job(snapshot))).rejects.toThrow('新增职位超时');
  });

  it('completes when the observed end marker arrives after scrolling without increasing the page count', async () => {
    const test = scrollingFixture();
    test.adapter.listExhausted = listExhausted;
    test.scroll.mockImplementation(() =>
      setTimeout(
        () =>
          test.panel.insertAdjacentHTML(
            'beforeend',
            '<div class="job-list-panel__status job-list-panel__status--more"><div><span>没有更多了</span></div></div>',
          ),
        600,
      ),
    );
    const snapshot = test.reader.prepare('scroll', { allowNextPage: true });
    const pending = test.reader.step({ ...snapshot, kind: 'next_page' });
    await vi.advanceTimersByTimeAsync(3200);
    const result = await pending;
    expect(result.done).toBe(true);
    expect(result.endOfList).toBe(true);
    expect(result.pageNumber).toBe(1);
    expect(result.pageKey).toBe(snapshot.pageKey);
    expect(result.canNextPage).toBe(false);
    expect(result.targets).toHaveLength(2);
    expect(test.scroll).toHaveBeenCalledOnce();
    expect(test.clicks()).toBe(0);
  });

  it('keeps newly appended final-page cards available even when an end marker arrives with them', async () => {
    const test = scrollingFixture();
    test.adapter.listExhausted = listExhausted;
    test.scroll.mockImplementation(() =>
      setTimeout(() => {
        const card = test.panel.lastElementChild!.cloneNode(true) as HTMLElement;
        card.dataset.key = 'c';
        test.panel.append(card);
        test.panel.insertAdjacentHTML(
          'beforeend',
          '<div class="job-list-panel__status job-list-panel__status--more">没有更多了</div>',
        );
      }, 600),
    );
    const snapshot = test.reader.prepare('scroll', { allowNextPage: true });
    const pending = test.reader.step({ ...snapshot, kind: 'next_page' });
    await vi.advanceTimersByTimeAsync(3200);
    const result = await pending;
    expect(result.done).not.toBe(true);
    expect(result.endOfList).toBe(true);
    expect(result.pageNumber).toBe(2);
    expect(result.targets).toHaveLength(3);
  });

  it('pauses instead of completing when the list reports a load error', async () => {
    const test = scrollingFixture();
    test.adapter.listExhausted = listExhausted;
    test.scroll.mockImplementation(() =>
      setTimeout(
        () =>
          test.panel.insertAdjacentHTML(
            'beforeend',
            '<div class="job-list-panel__status job-list-panel__status--more">网络错误，请重试</div>',
          ),
        600,
      ),
    );
    const snapshot = test.reader.prepare('scroll', { allowNextPage: true });
    const rejection = expect(test.reader.step({ ...snapshot, kind: 'next_page' })).rejects.toThrow(
      '新增职位超时',
    );
    await vi.advanceTimersByTimeAsync(15200);
    await rejection;
  });

  it('does not treat a replaced list as a successful appended page', async () => {
    const test = scrollingFixture();
    test.scroll.mockImplementation(() =>
      setTimeout(() => {
        test.panel.firstElementChild!.setAttribute('data-key', 'unexpected-filter');
      }, 600),
    );
    const snapshot = test.reader.prepare('scroll', { allowNextPage: true });
    const rejection = expect(test.reader.step({ ...snapshot, kind: 'next_page' })).rejects.toThrow(
      '新增职位超时',
    );
    await vi.advanceTimersByTimeAsync(15200);
    await rejection;
    expect(test.clicks()).toBe(0);
  });

  it('refuses a submit or communication control even if a broken selector returns it', async () => {
    const test = fixture();
    const button = document.createElement('button');
    button.textContent = '立即投递';
    document.body.append(button);
    const click = vi.fn();
    button.addEventListener('click', click);
    test.adapter.listTargets = () => [
      { key: 'unsafe', title: '岗位', company: '公司', element: button },
    ];
    const snapshot = test.reader.prepare('task');
    const rejection = expect(test.reader.step(job(snapshot, 'unsafe'))).rejects.toThrow('安全');
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(click).not.toHaveBeenCalled();
  });

  it('does not claim a match without either platform id or an unambiguous company', async () => {
    const test = fixture();
    const original = test.adapter.listTargets;
    test.adapter.listTargets = (...args) =>
      original(...args).map((target) => ({ ...target, platform_job_id: '', company: '' }));
    const snapshot = test.reader.prepare('task');
    const rejection = expect(test.reader.step(job(snapshot))).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(15200);
    await rejection;
  });

  it('enforces the item limit and does not claim list previews as full details', async () => {
    const test = fixture();
    const snapshot = test.reader.prepare('task', { maxItems: 1 });
    const pending = test.reader.step(job(snapshot));
    await vi.advanceTimersByTimeAsync(3200);
    const result = await pending;
    expect(result.done).toBe(true);
    expect((await test.reader.step(job(result, 'b'))).done).toBe(true);
    expect(test.clicks()).toBe(1);
  });

  it('never promotes a list-only preview into a collected detail', async () => {
    const test = fixture();
    const original = test.adapter.observe;
    test.adapter.observe = (...args) =>
      original(...args).map((observation) => ({ ...observation, page_kind: 'list' }));
    const snapshot = test.reader.prepare('task');
    const rejection = expect(test.reader.step(job(snapshot))).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(15200);
    await rejection;
  });
});

describe('one bounded reselection of an empty selected Zhilian detail', () => {
  it('recovers through the two empty detail shells observed on the real Zhilian page', async () => {
    const test = emptyZhilianFixture();
    test.onClick((key, count) => {
      test.module.innerHTML =
        '<div class="job-detail-modules__detail"><div class="job-detail-modules__scroll"></div></div>';
      if (count === 2) setTimeout(() => test.complete(key), 1000);
    });
    const snapshot = test.reader.prepare('real_empty_shell');
    const pending = test.reader.step(job(snapshot));
    await vi.advanceTimersByTimeAsync(8200);
    expect(test.clickCount()).toBe(2);
    expect((await pending).observation?.platform_job_id).toBe('a');
  });

  it.each([
    '<div class="unknown-empty-placeholder"></div>',
    '<div class="job-detail-modules__detail"><div class="job-detail-modules__scroll"><canvas></canvas></div></div>',
    '<div class="job-detail-modules__detail"><div class="job-detail-modules__scroll" aria-busy="true"></div></div>',
  ])('does not reselect an unknown or busy empty subtree: %s', async (placeholder) => {
    const test = emptyZhilianFixture();
    test.onClick(() => {
      test.module.innerHTML = placeholder;
    });
    const snapshot = test.reader.prepare('unknown_empty_shell');
    const rejection = expect(test.reader.step(job(snapshot))).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(15000);
    await rejection;
    expect(test.clickCount()).toBe(1);
  });

  it('waits at least five seconds, reselects the same card once and accepts only its settled result', async () => {
    const test = emptyZhilianFixture();
    const started = Date.now();
    test.onClick((key, count) => {
      if (count === 2) setTimeout(() => test.complete(key), 1000);
    });
    const snapshot = test.reader.prepare('recover');
    const pending = test.reader.step(job(snapshot));
    await vi.advanceTimersByTimeAsync(4800);
    expect(test.clickCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(test.clickCount()).toBe(2);
    expect(test.clickTimes).toEqual([started, started + 5000]);
    await vi.advanceTimersByTimeAsync(3200);
    expect(await pending).toMatchObject({
      observation: { platform_job_id: 'a', text: '完整智联描述 a' },
      completed: 1,
    });
    expect(document.querySelector('.card.active')?.getAttribute('data-key')).toBe('a');
  });

  it('never reselects a third time and still pauses at the original fifteen-second total deadline', async () => {
    const test = emptyZhilianFixture();
    const snapshot = test.reader.prepare('still_empty');
    const rejection = expect(test.reader.step(job(snapshot))).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(15000);
    await rejection;
    expect(test.clickCount()).toBe(2);
    await expect(test.reader.step(job(snapshot))).rejects.toThrow('超时');
    expect(test.clickCount()).toBe(2);
  });

  it.each(['stop', 'hidden', 'user', 'challenge', 'list', 'selection'] as const)(
    'does not reselect after %s changes during the wait',
    async (change) => {
      const test = emptyZhilianFixture();
      const snapshot = test.reader.prepare('cancel_recovery');
      const rejection = expect(test.reader.step(job(snapshot))).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(4000);
      if (change === 'stop') test.reader.stop('cancel_recovery');
      if (change === 'hidden') {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }
      if (change === 'user') {
        const click = new MouseEvent('click', { bubbles: true });
        Object.defineProperty(click, 'isTrusted', { value: true });
        document.body.dispatchEvent(click);
      }
      if (change === 'challenge')
        document.body.insertAdjacentHTML('beforeend', '<div id="captcha">请完成验证</div>');
      if (change === 'list')
        test.panel.querySelector<HTMLElement>('[data-key="a"]')!.dataset.key = 'changed';
      if (change === 'selection') {
        test.panel.querySelector('[data-key="a"]')!.classList.remove('active');
        test.panel.querySelector('[data-key="b"]')!.classList.add('active');
      }
      await vi.advanceTimersByTimeAsync(11200);
      await rejection;
      expect(test.clickCount()).toBe(1);
    },
  );

  it.each(['loading', 'old-detail'] as const)('does not reselect a %s state', async (state) => {
    const test = emptyZhilianFixture();
    if (state === 'loading') test.module.setAttribute('aria-busy', 'true');
    else test.module.innerHTML = '<p>其他职位的旧描述，不能当作本条空白重试</p>';
    test.onClick(() => {
      if (state === 'old-detail') test.module.innerHTML = '<p>其他职位的旧描述</p>';
    });
    const snapshot = test.reader.prepare('no_recovery');
    const rejection = expect(test.reader.step(job(snapshot))).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(15000);
    await rejection;
    expect(test.clickCount()).toBe(1);
  });

  it('keeps complete details free of recovery clicks and spaces consecutive Zhilian actions by five seconds', async () => {
    const test = emptyZhilianFixture();
    test.onClick((key) => test.complete(key));
    const snapshot = test.reader.prepare('spacing');
    const first = test.reader.step(job(snapshot));
    await vi.advanceTimersByTimeAsync(3200);
    const firstResult = await first;
    const second = test.reader.step(job(firstResult, 'b'));
    await vi.advanceTimersByTimeAsync(1600);
    expect(test.clickCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(test.clickCount()).toBe(2);
    expect(test.clickTimes[1] - test.clickTimes[0]).toBe(5000);
    await vi.advanceTimersByTimeAsync(3200);
    expect((await second).observation?.platform_job_id).toBe('b');
    expect(test.clickCount()).toBe(2);
  });
});

describe('strict Zhilian city and administrative district identity', () => {
  it('distinguishes the uniquely selected city/district while ignoring differing street names', async () => {
    const test = districtIdentityFixture();
    const snapshot = test.reader.prepare('district_match');
    const pending = test.reader.step(job(snapshot, snapshot.targets[0].key));
    await vi.advanceTimersByTimeAsync(3200);
    expect(await pending).toMatchObject({
      observation: { platform_job_id: 'RIGHT_A', text: expect.stringContaining('陈庄') },
      completed: 1,
    });
    expect(test.cards[0].textContent).toContain('杜岭');
    expect(test.click).not.toHaveBeenCalled();
  });

  it.each([
    ['郑州市 金水 杜岭', '郑州·金水区·陈庄'],
    ['郑州 新郑 杜岭', '郑州·新郑市·陈庄'],
    ['郑州 合成 杜岭', '郑州·合成县·陈庄'],
  ])('allows only one optional administrative suffix: %s / %s', async (first, right) => {
    const test = districtIdentityFixture(first, undefined, right);
    const snapshot = test.reader.prepare('suffix');
    const pending = test.reader.step(job(snapshot, snapshot.targets[0].key));
    await vi.advanceTimersByTimeAsync(3200);
    expect((await pending).observation?.platform_job_id).toBe('RIGHT_A');
  });

  it.each([
    ['same-district', '郑州 金水 杜岭', '郑州 金水 金岱', '郑州·金水区·陈庄'],
    ['missing-other-district', '郑州 金水 杜岭', '郑州', '郑州·金水区·陈庄'],
    ['missing-right-district', '郑州 金水 杜岭', '郑州 管城 金岱', '郑州'],
    ['unknown-right-district', '郑州 金水 杜岭', '郑州 管城 金岱', '郑州·未知'],
    ['conflicting-suffix', '郑州 金水区 杜岭', '郑州 管城 金岱', '郑州·金水县·陈庄'],
    ['substring-district', '郑州 金水新区 杜岭', '郑州 管城 金岱', '郑州·金水区·陈庄'],
    ['different-city', '郑州 金水 杜岭', '郑州 管城 金岱', '开封·金水区·陈庄'],
  ])('keeps %s identity ambiguous', async (_name, first, second, right) => {
    const test = districtIdentityFixture(first, second, right);
    const snapshot = test.reader.prepare('district_reject');
    const rejection = expect(
      test.reader.step(job(snapshot, snapshot.targets[0].key)),
    ).rejects.toThrow('身份待核对');
    await vi.advanceTimersByTimeAsync(15000);
    await rejection;
    expect(test.click).toHaveBeenCalledOnce();
  });

  it('rejects a selected B card while the late right detail still identifies A district', async () => {
    const test = districtIdentityFixture();
    const snapshot = test.reader.prepare('late_a');
    const rejection = expect(
      test.reader.step(job(snapshot, snapshot.targets[1].key)),
    ).rejects.toThrow('身份待核对');
    await vi.advanceTimersByTimeAsync(15000);
    await rejection;
    expect(test.cards[1].classList.contains('job-card--active')).toBe(true);
    expect(test.click).toHaveBeenCalledOnce();
  });

  it.each([
    'missing-link',
    'link-id-mismatch',
    'two-link-ids',
    'other-card-id',
    'other-left-panel',
    'two-right-modules',
  ] as const)('rejects %s despite matching geography', async (problem) => {
    const test = districtIdentityFixture();
    if (problem === 'missing-link') test.root.querySelector('a')!.remove();
    if (problem === 'link-id-mismatch')
      test.root
        .querySelector('a')!
        .setAttribute('href', 'https://www.zhaopin.com/jobdetail/OTHER.htm');
    if (problem === 'two-link-ids')
      test.root.insertAdjacentHTML(
        'beforeend',
        '<a href="https://www.zhaopin.com/jobdetail/OTHER.htm">查看更多职位信息</a>',
      );
    if (problem === 'other-card-id') test.cards[1].dataset.id = 'RIGHT_A';
    if (problem === 'other-left-panel') {
      const column = document.querySelector('.job-split-layout__left')!;
      const panel = document.createElement('div');
      panel.className = 'job-list-panel';
      panel.append(test.cards[1]);
      column.append(panel);
    }
    if (problem === 'two-right-modules') document.body.append(test.root.cloneNode(true));
    const snapshot = test.reader.prepare('provenance');
    const rejection = expect(
      test.reader.step(job(snapshot, snapshot.targets[0].key)),
    ).rejects.toThrow('身份待核对');
    await vi.advanceTimersByTimeAsync(15000);
    await rejection;
  });
});
