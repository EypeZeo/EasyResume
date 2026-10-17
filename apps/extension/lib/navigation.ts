export type RecruitingPlatform = 'boss' | 'zhilian';
export type RecruitingPageKind =
  'list' | 'detail' | 'home' | 'chat' | 'login' | 'verification' | 'other';

export type RecruitingPage = {
  platform?: RecruitingPlatform;
  kind: RecruitingPageKind;
};

export type RecruitingPageStatus = {
  page: RecruitingPage;
  entries: RecruitingEntrypoint[];
  canRead: boolean;
  listCount: number;
  message?: string;
  diagnostics?: unknown;
};

const BOSS_HOSTS = new Set(['www.zhipin.com', 'zhipin.com']);
const ZHILIAN_HOSTS = new Set([
  'www.zhaopin.com',
  'zhaopin.com',
  'sou.zhaopin.com',
  'jobs.zhaopin.com',
]);

/** URL classification is a navigation hint; the content adapter must still verify the visible DOM. */
export function classifyRecruitingPage(href: string | undefined): RecruitingPage {
  let url: URL;
  try {
    url = new URL(href ?? '');
  } catch {
    return { kind: 'other' };
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    return { kind: 'other' };
  const platform = BOSS_HOSTS.has(url.hostname)
    ? 'boss'
    : ZHILIAN_HOSTS.has(url.hostname)
      ? 'zhilian'
      : undefined;
  if (!platform) return { kind: 'other' };
  const path = url.pathname;
  if (/\/(?:security|verify|verification|captcha)(?:[./_-]|$)/i.test(path))
    return { platform, kind: 'verification' };
  if (/\/(?:passport|login|signin|user)(?:[./_-]|$)/i.test(path))
    return { platform, kind: 'login' };
  if (/\/(?:chat|message|messages|resume|resumes)(?:[./_-]|$)/i.test(path))
    return { platform, kind: 'chat' };
  if (platform === 'boss') {
    if (/^\/job_detail\/[^/]+\.html?\/?$/i.test(path)) return { platform, kind: 'detail' };
    if (/^\/web\/geek\/(?:jobs?|job-recommend)(?:\/|$)/.test(path))
      return { platform, kind: 'list' };
  } else {
    if (
      /^\/jobdetail\/[^/]+(?:\/|$)/i.test(path) ||
      (url.hostname === 'jobs.zhaopin.com' && /^\/[^/]+\.html?\/?$/i.test(path))
    )
      return { platform, kind: 'detail' };
    if (
      /^\/(?:jobs|recommend)(?:\/|$)/.test(path) ||
      (url.hostname === 'sou.zhaopin.com' && path === '/')
    )
      return { platform, kind: 'list' };
  }
  return {
    platform,
    kind:
      path === '/' ||
      /^\/index\.html?$/i.test(path) ||
      (platform === 'boss' && /^\/[a-z]+\/$/i.test(path))
        ? 'home'
        : 'other',
  };
}

export type RecruitingTab = {
  id: number;
  windowId: number;
  incognito: boolean;
  url?: string;
  title?: string;
};

type TabChoice = {
  tabId: number;
  platform: RecruitingPlatform;
  kind: 'list' | 'detail';
  title: string;
};

const BOSS_CITY_NAMES: Record<string, string> = {
  '100010000': '全国',
  '101010100': '北京',
  '101020100': '上海',
  '101280100': '广州',
  '101280600': '深圳',
  '101210100': '杭州',
  '101180100': '郑州',
  '101030100': '天津',
  '101040100': '重庆',
  '101270100': '成都',
  '101200100': '武汉',
  '101110100': '西安',
};

function singleParameter(url: URL, keys: string[]): string {
  for (const key of keys) {
    const values = url.searchParams.getAll(key);
    if (values.length === 1 && values[0].trim()) return values[0].trim();
  }
  return '';
}

/** Display only short search terms; URL metadata and opaque values never become labels. */
function readableSearch(value: string): string {
  const text = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (
    !text ||
    text.length > 36 ||
    !/^[\p{L}\p{N} .+#()\-·]+$/u.test(text) ||
    /\d{6,}|[a-zA-Z0-9_-]{20,}|(?:token|session|cookie|secret|password|bearer|authorization|账号|密码|验证码)/i.test(
      text,
    )
  )
    return '';
  return text;
}

function recruitingTabTitle(href: string, page: RecruitingPage): string {
  const url = new URL(href);
  const keyword = readableSearch(
    singleParameter(url, page.platform === 'boss' ? ['query'] : ['kw', 'keyword', 'query']),
  );
  const recommended =
    page.kind === 'list' &&
    (/(?:^|\/)(?:recommend|job-recommend)(?:\/|$)/.test(url.pathname) ||
      url.searchParams.get('pageMode') === 'recommend');
  const kind =
    page.kind === 'detail'
      ? '职位详情'
      : recommended
        ? '推荐职位'
        : keyword
          ? '搜索职位'
          : '职位列表';
  const labels = [page.platform === 'boss' ? 'BOSS直聘' : '智联招聘', kind];
  if (page.kind === 'detail') return labels.join(' · ');
  if (keyword) labels.push(keyword);
  const city = singleParameter(url, page.platform === 'boss' ? ['city'] : ['city', 'jl']);
  if (city) {
    const knownCity =
      page.platform === 'boss' && Object.hasOwn(BOSS_CITY_NAMES, city)
        ? BOSS_CITY_NAMES[city]
        : page.platform === 'zhilian' && city === '719' && singleParameter(url, ['jl']) === '719'
          ? '郑州'
          : undefined;
    labels.push(knownCity ?? (Object.values(BOSS_CITY_NAMES).includes(city) ? city : '已选地区'));
  }
  const pageNumber = singleParameter(url, ['page']);
  if (/^[1-9]\d{0,2}$/.test(pageNumber)) labels.push(`第 ${Number(pageNumber)} 页`);
  if (page.platform === 'boss' && singleParameter(url, ['salary'])) labels.push('已选薪资范围');
  return labels.join(' · ');
}

export type RecruitingTabResolution =
  | { state: 'ready' | 'activate'; choice: TabChoice }
  | { state: 'choose'; choices: TabChoice[] }
  | { state: 'needs-page'; platform?: RecruitingPlatform }
  | { state: 'blocked'; platform: RecruitingPlatform; kind: 'login' | 'verification' | 'chat' };

/** Never silently crosses a browser window, an incognito boundary, or multiple eligible tabs. */
export function resolveRecruitingTab(
  tabs: RecruitingTab[],
  context: {
    windowId: number;
    incognito: boolean;
    activeTabId?: number;
    platform?: RecruitingPlatform;
    purpose: 'current' | 'batch';
  },
): RecruitingTabResolution {
  const scoped = tabs.filter(
    (tab) => tab.windowId === context.windowId && tab.incognito === context.incognito,
  );
  const active = scoped.find((tab) => tab.id === context.activeTabId);
  const current = classifyRecruitingPage(active?.url);
  const platform = context.platform ?? current.platform;
  if (
    current.platform &&
    ['login', 'verification', 'chat'].includes(current.kind) &&
    (!context.platform || context.platform === current.platform)
  )
    return {
      state: 'blocked',
      platform: current.platform,
      kind: current.kind as 'login' | 'verification' | 'chat',
    };
  const choices: TabChoice[] = scoped.flatMap((tab) => {
    const page = classifyRecruitingPage(tab.url);
    if (
      !page.platform ||
      (platform && page.platform !== platform) ||
      (page.kind !== 'list' && (context.purpose === 'batch' || page.kind !== 'detail'))
    )
      return [];
    return [
      {
        tabId: tab.id,
        platform: page.platform,
        kind: page.kind,
        title: recruitingTabTitle(tab.url!, page),
      },
    ];
  });
  const duplicateCounts = new Map<string, number>();
  for (const choice of choices)
    duplicateCounts.set(choice.title, (duplicateCounts.get(choice.title) ?? 0) + 1);
  const duplicateIndexes = new Map<string, number>();
  for (const choice of choices) {
    if ((duplicateCounts.get(choice.title) ?? 0) < 2) continue;
    const index = (duplicateIndexes.get(choice.title) ?? 0) + 1;
    duplicateIndexes.set(choice.title, index);
    choice.title += `（选项 ${index}）`;
  }
  const currentChoice = choices.find((choice) => choice.tabId === context.activeTabId);
  if (currentChoice) return { state: 'ready', choice: currentChoice };
  if (choices.length === 1) return { state: 'activate', choice: choices[0] };
  if (choices.length > 1) return { state: 'choose', choices };
  return { state: 'needs-page', ...(platform ? { platform } : {}) };
}

export type ObservedNavigationLink = { href: string; text: string };
export type RecruitingEntrypoint = { url: string; text: string };

/** Inputs must be links actually observed on the current page, never synthesized search URLs. */
export function observedRecruitingEntrypoints(
  href: string,
  links: ObservedNavigationLink[],
): RecruitingEntrypoint[] {
  const source = classifyRecruitingPage(href);
  if (!source.platform || ['login', 'verification', 'chat'].includes(source.kind)) return [];
  const unique = new Map<string, RecruitingEntrypoint>();
  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link.href, href);
    } catch {
      continue;
    }
    const destination = classifyRecruitingPage(url.href);
    if (destination.platform !== source.platform || destination.kind !== 'list') continue;
    url.hash = '';
    if (!unique.has(url.href))
      unique.set(url.href, { url: url.href, text: link.text.trim().slice(0, 80) });
  }
  return [...unique.values()];
}

/** An ambiguous menu is shown to the user instead of guessing a city or search preference. */
export function chooseRecruitingEntrypoint(
  entries: RecruitingEntrypoint[],
):
  | { state: 'ready'; entry: RecruitingEntrypoint }
  | { state: 'choose'; entries: RecruitingEntrypoint[] }
  | { state: 'unavailable' } {
  if (!entries.length) return { state: 'unavailable' };
  if (entries.length === 1) return { state: 'ready', entry: entries[0] };
  const primary = entries.filter((entry) =>
    /^(职位|找工作|职位搜索|搜索职位|招聘职位)$/.test(entry.text),
  );
  if (primary.length === 1) return { state: 'ready', entry: primary[0] };
  return { state: 'choose', entries };
}
