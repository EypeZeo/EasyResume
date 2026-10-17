// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBatchReader, type BatchAdapter, type BatchSnapshot } from './batch';
import { listExhausted, type Observation } from './observe';

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
