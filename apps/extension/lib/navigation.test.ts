import { describe, expect, it } from 'vitest';
import {
  chooseRecruitingEntrypoint,
  classifyRecruitingPage,
  observedRecruitingEntrypoints,
  resolveRecruitingTab,
  type RecruitingTab,
} from './navigation';

const bossList = 'https://www.zhipin.com/web/geek/jobs?city=101180100&query=Linux';
const zhilianList = 'https://www.zhaopin.com/jobs/?pageMode=recommend';
const context = { windowId: 7, incognito: false, activeTabId: 1, purpose: 'batch' as const };
const tab = (id: number, url: string, extra: Partial<RecruitingTab> = {}): RecruitingTab => ({
  id,
  url,
  windowId: 7,
  incognito: false,
  ...extra,
});

describe('recruitment page classification', () => {
  it.each([
    [bossList, 'boss', 'list'],
    ['https://www.zhipin.com/web/geek/job-recommend', 'boss', 'list'],
    ['https://www.zhipin.com/job_detail/synthetic.html', 'boss', 'detail'],
    [zhilianList, 'zhilian', 'list'],
    ['https://sou.zhaopin.com/?jl=synthetic', 'zhilian', 'list'],
    ['https://www.zhaopin.com/jobs/recommend', 'zhilian', 'list'],
    ['https://www.zhaopin.com/jobdetail/synthetic.htm', 'zhilian', 'detail'],
    ['https://jobs.zhaopin.com/synthetic.htm', 'zhilian', 'detail'],
    ['https://www.zhipin.com/', 'boss', 'home'],
    ['https://www.zhipin.com/zhengzhou/', 'boss', 'home'],
    ['https://www.zhaopin.com/', 'zhilian', 'home'],
    ['https://www.zhipin.com/web/passport/zp/security.html', 'boss', 'verification'],
    ['https://www.zhipin.com/web/user/', 'boss', 'login'],
    ['https://www.zhipin.com/web/geek/chat', 'boss', 'chat'],
    ['https://www.zhaopin.com/resume', 'zhilian', 'chat'],
  ])('classifies %s without using title or guessed DOM', (url, platform, kind) => {
    expect(classifyRecruitingPage(url)).toEqual({ platform, kind });
  });

  it.each([
    'http://www.zhipin.com/web/geek/jobs',
    'https://www.zhipin.com.evil.example/web/geek/jobs',
    'https://www.zhipin.com:8443/web/geek/jobs',
    'https://user@www.zhaopin.com/jobs/',
    'https://jobs.zhaopin.com/',
    'https://www.zhipin.com/web/geek/jobs-invalid',
    'not a URL',
  ])('does not treat an unsupported source as a readable page: %s', (url) => {
    expect(['list', 'detail']).not.toContain(classifyRecruitingPage(url).kind);
  });
});

describe('same-context recruiting tab selection', () => {
  it('keeps the active supported list even when other searches are open', () => {
    expect(
      resolveRecruitingTab([tab(1, bossList), tab(2, bossList + '&salary=high')], context),
    ).toMatchObject({ state: 'ready', choice: { tabId: 1, kind: 'list' } });
  });

  it('finds one existing list from the same platform when its home page is active', () => {
    expect(
      resolveRecruitingTab(
        [tab(1, 'https://www.zhipin.com/'), tab(2, bossList), tab(3, zhilianList)],
        context,
      ),
    ).toMatchObject({ state: 'activate', choice: { tabId: 2, platform: 'boss' } });
  });

  it('requires selection when multiple different recruiting searches could be intended', () => {
    const result = resolveRecruitingTab(
      [tab(1, 'https://www.zhipin.com/'), tab(2, bossList), tab(3, bossList + '&salary=high')],
      context,
    );
    expect(result).toMatchObject({ state: 'choose', choices: [{ tabId: 2 }, { tabId: 3 }] });
  });

  it('excludes another window and incognito rather than silently choosing a different account context', () => {
    expect(
      resolveRecruitingTab(
        [
          tab(1, 'https://www.zhipin.com/'),
          tab(2, bossList, { windowId: 8 }),
          tab(3, bossList, { incognito: true }),
        ],
        context,
      ),
    ).toEqual({ state: 'needs-page', platform: 'boss' });
  });

  it('does not substitute a different platform for an active platform home page', () => {
    expect(
      resolveRecruitingTab([tab(1, 'https://www.zhipin.com/'), tab(2, zhilianList)], context),
    ).toEqual({ state: 'needs-page', platform: 'boss' });
  });

  it('allows current details to be read but requires a list for batch mode', () => {
    const tabs = [tab(1, 'https://www.zhipin.com/job_detail/synthetic.html')];
    expect(resolveRecruitingTab(tabs, { ...context, purpose: 'current' })).toMatchObject({
      state: 'ready',
      choice: { kind: 'detail' },
    });
    expect(resolveRecruitingTab(tabs, context)).toEqual({ state: 'needs-page', platform: 'boss' });
  });

  it.each([
    ['https://www.zhipin.com/web/passport/zp/security.html', 'verification'],
    ['https://www.zhipin.com/web/user/', 'login'],
    ['https://www.zhipin.com/web/geek/chat', 'chat'],
  ])('does not navigate away from a restricted active page: %s', (url, kind) => {
    expect(resolveRecruitingTab([tab(1, url), tab(2, bossList)], context)).toEqual({
      state: 'blocked',
      platform: 'boss',
      kind,
    });
  });
});

describe('observed recruitment navigation links', () => {
  it('uses an observed relative job entry and retains its existing city and filters', () => {
    const entries = observedRecruitingEntrypoints('https://www.zhipin.com/', [
      { href: '/web/geek/jobs?city=101180100&query=Linux', text: '职位' },
    ]);
    expect(chooseRecruitingEntrypoint(entries)).toEqual({
      state: 'ready',
      entry: { url: bossList, text: '职位' },
    });
  });

  it('rejects external, cross-platform, non-HTTPS, detail and login links', () => {
    expect(
      observedRecruitingEntrypoints('https://www.zhipin.com/', [
        { href: 'https://www.zhipin.com.evil.example/web/geek/jobs', text: '职位' },
        { href: zhilianList, text: '职位' },
        { href: 'http://www.zhipin.com/web/geek/jobs', text: '职位' },
        { href: '/job_detail/synthetic.html', text: '职位' },
        { href: '/web/user/', text: '职位' },
      ]),
    ).toEqual([]);
  });

  it('deduplicates observed entries and prefers one explicit site navigation entry over categories', () => {
    const entries = observedRecruitingEntrypoints('https://www.zhaopin.com/', [
      { href: '/jobs/?pageMode=recommend', text: '职位' },
      { href: '/jobs/?pageMode=recommend#top', text: '职位' },
      { href: '/jobs/?query=Linux', text: 'Linux' },
    ]);
    expect(entries).toHaveLength(2);
    expect(chooseRecruitingEntrypoint(entries)).toEqual({
      state: 'ready',
      entry: { url: zhilianList, text: '职位' },
    });
  });

  it('does not guess a preferred search from multiple observed categories', () => {
    const entries = observedRecruitingEntrypoints('https://www.zhipin.com/', [
      { href: '/web/geek/jobs?query=Linux', text: 'Linux' },
      { href: '/web/geek/jobs?query=Citrix', text: 'Citrix' },
    ]);
    expect(chooseRecruitingEntrypoint(entries)).toEqual({ state: 'choose', entries });
  });

  it('does not propose navigation from a verification page or invent a missing job link', () => {
    expect(
      observedRecruitingEntrypoints('https://www.zhipin.com/web/passport/zp/security.html', [
        { href: bossList, text: '职位' },
      ]),
    ).toEqual([]);
    expect(chooseRecruitingEntrypoint([])).toEqual({ state: 'unavailable' });
  });
});
