export type Observation = {
  protocol: 1;
  url: string;
  title: string;
  company: string;
  text: string;
  platform_job_id: string;
  city: string;
  page_kind: 'list' | 'detail' | 'unknown';
  employment_type: 'full_time' | 'internship' | 'part_time' | 'unknown';
  recruitment_type: 'campus' | 'social' | 'unknown';
  blocked: boolean;
};

export function localServer(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('请输入本地工作台根地址，例如 http://127.0.0.1:8765');
  return url.origin;
}

export const RECRUITING_HOSTS = [
  'www.zhipin.com',
  'zhipin.com',
  'www.zhaopin.com',
  'zhaopin.com',
  'sou.zhaopin.com',
  'jobs.zhaopin.com',
];
const boss = (url: URL) => ['www.zhipin.com', 'zhipin.com'].includes(url.hostname);
export function visible(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (
      style?.display === 'none' ||
      style?.visibility === 'hidden' ||
      style?.visibility === 'collapse' ||
      style?.opacity === '0'
    )
      return false;
  }
  return true;
}

function rawText(node: Node, omit = ''): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (!(node instanceof node.ownerDocument!.defaultView!.Element)) return '';
  if (!visible(node) || node.matches('script,style,button,iframe') || (omit && node.matches(omit)))
    return '';
  if (node.tagName === 'BR') return '\n';
  const value = Array.from(node.childNodes)
    .map((child) => rawText(child, omit))
    .join('');
  return /^(DIV|P|LI|SECTION|H[1-6])$/.test(node.tagName) ? `\n${value}\n` : value;
}

function elements(root: ParentNode, selectors: string): Element[] {
  // A selector list is a preference order, not DOM order. Include the supplied root itself.
  return selectors.split(',').flatMap((selector) => {
    const own = 'matches' in root && (root as Element).matches(selector) ? [root as Element] : [];
    return [...own, ...root.querySelectorAll(selector)].filter(visible);
  });
}

function formatted(value: string, lines: boolean): string {
  return lines
    ? value.replace(/[\t ]+/g, ' ').replace(/\n\s*\n/g, '\n')
    : value.replace(/\s+/g, ' ');
}

function text(root: ParentNode, selectors: string, lines = false): string {
  for (const element of elements(root, selectors)) {
    const value = rawText(element).trim();
    if (value) return formatted(value, lines);
  }
  return '';
}

function redact(value: string): string {
  return value
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[手机号已省略]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[邮箱已省略]')
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, '[身份证号已省略]');
}

function allowedPage(document: Document, href: string): URL {
  const url = new URL(href);
  if (
    url.protocol !== 'https:' ||
    !RECRUITING_HOSTS.includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error('仅支持当前 BOSS 或智联招聘职位页');
  if (
    /\/chat(?:\/|$)|\/passport(?:\/|$)|\/user(?:\/|$)|\/login|\/resume(?:\/|$)/i.test(url.pathname)
  )
    throw new Error('不读取聊天、登录或个人资料页面');
  const challenge = Array.from(
    document.querySelectorAll('[class*="captcha"], #captcha, [class*="geetest"]'),
  ).some(
    (e) => visible(e) && (!!e.textContent?.trim() || !!e.querySelector('iframe,canvas,input,img')),
  );
  const warnings = Array.from(document.querySelectorAll('[role="alert"],.verify-page,.error-page'))
    .filter(visible)
    .map((e) => e.textContent?.slice(0, 300))
    .join(' ');
  if (challenge || /请完成验证|安全验证|访问异常|账号异常|操作频繁/.test(document.title + warnings))
    throw new Error('检测到验证或异常，请处理后手动重试');
  const isJob = boss(url)
    ? /\/job_detail\/|^\/web\/geek\/jobs?(?:[-/]|$)/.test(url.pathname)
    : /\/jobs(?:\/|$)|\/jobdetail\/|\/recommend(?:\/|$)/.test(url.pathname) ||
      url.hostname === 'jobs.zhaopin.com' ||
      url.hostname === 'sou.zhaopin.com';
  if (!isJob) throw new Error('请打开职位列表或详情页');
  return url;
}

function jobId(url: URL): string {
  return (
    url.pathname.match(/\/(?:job_detail|jobdetail)\/([^/.]+)/)?.[1] ??
    (url.hostname === 'jobs.zhaopin.com'
      ? (url.pathname.match(/^\/([^/.]+)\.htm[l]?$/)?.[1] ?? '')
      : '')
  );
}

function detailLink(
  root: ParentNode,
  url: URL,
  currentTitle: string,
  card = false,
): URL | undefined {
  const links: URL[] = [];
  for (const a of elements(
    root,
    'a[href*="/job_detail/"],a[href*="/jobdetail/"],a[href*="jobs.zhaopin.com/"]',
  )) {
    let target: URL;
    try {
      target = new URL(a.getAttribute('href')!, url);
    } catch {
      continue;
    }
    const label = rawText(a).replace(/\s/g, '');
    const current =
      label === currentTitle.replace(/\s/g, '') &&
      (a.matches('.job-name,.job-title,.job-detail-summary__title-text') ||
        !!a.closest('.job-name,.job-title,.job-detail-summary__title-text') ||
        !!a.querySelector('.job-name,.job-title,.job-detail-summary__title-text'));
    if (!card && (a.closest(JOB_CARDS) || (!current && !/^查看更多(?:职位)?信息$/.test(label))))
      continue;
    if (
      visible(a) &&
      RECRUITING_HOSTS.includes(target.hostname) &&
      boss(url) === boss(target) &&
      target.protocol === 'https:' &&
      !target.username &&
      !target.password &&
      jobId(target)
    )
      links.push(target);
  }
  const unique = [
    ...new Map(links.map((target) => [target.origin + target.pathname, target])).values(),
  ];
  if (unique.length === 1) return unique[0];
}

const BOSS_ROOTS =
  '.job-detail-box,.job-detail-container,.job-detail-content,.detail-content,.job-detail';
const BOSS_TITLE = '.job-title .name,.job-name,.name h1,.job-title h1,h1';
const BOSS_DESCRIPTION =
  '.job-detail-body > .desc,.job-sec-text,.job-detail-section .text,.job-description';
const JOB_CARDS = '.job-card-box,.job-card-wrapper,.job-card-body,.job-card';
const JOB_LISTS = '.job-list-box,.job-list-container,.job-split-layout__left,.job-list-panel';
const TITLE_METADATA = '.salary,.job-salary';

function outsideCard(element: Element): boolean {
  return !element.closest(JOB_CARDS);
}

function bossTitle(root: ParentNode, card = false): string {
  for (const element of elements(root, BOSS_TITLE)) {
    if ((!card && !outsideCard(element)) || element.closest(BOSS_DESCRIPTION)) continue;
    const value = rawText(element, TITLE_METADATA).trim();
    if (value) return formatted(value, false);
  }
  // Older layouts use .job-title for both a leaf title and a title/salary container.
  // Only accept one remaining text part; ambiguous sibling labels are not a title.
  for (const element of elements(root, '.job-title')) {
    if ((!card && !outsideCard(element)) || element.closest(BOSS_DESCRIPTION)) continue;
    const parts = Array.from(element.childNodes)
      .map((node) => rawText(node, TITLE_METADATA).trim())
      .filter(Boolean);
    if (parts.length === 1) return formatted(parts[0], false);
  }
  return '';
}

function detailText(root: ParentNode, selectors: string, lines = false): string {
  for (const element of elements(root, selectors).filter(outsideCard)) {
    const value = rawText(element).trim();
    if (value) return formatted(value, lines);
  }
  return '';
}
const base = {
  protocol: 1 as const,
  city: '',
  employment_type: 'unknown' as const,
  recruitment_type: 'unknown' as const,
  blocked: false,
};

export type ReadTarget = {
  key: string;
  title: string;
  company: string;
  platform_job_id: string;
  element: HTMLElement;
};
export function listTargets(document: Document, href: string): ReadTarget[] {
  const url = allowedPage(document, href);
  const selector = boss(url)
    ? 'li.job-card-box,.job-card-wrapper,.job-list-box .job-card-body'
    : '.job-card';
  const cards = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(visible);
  return cards
    .filter((card) => !cards.some((other) => other !== card && other.contains(card)))
    .flatMap((card) => {
      const title = boss(url)
        ? bossTitle(card, true)
        : text(card, '.job-card__title-clamp,.job-card__title-main');
      if (!title) return [];
      const company = text(card, boss(url) ? '.company-name' : '.job-card__company-name');
      const link = detailLink(card, url, title, true);
      const location = text(
        card,
        boss(url) ? '.company-location,.job-area' : '.job-card__location',
      );
      return [
        {
          key: link?.href.split('?')[0] ?? `${title}\u001f${company}\u001f${location}`,
          title,
          company,
          platform_job_id: link ? jobId(link) : '',
          element: card,
        },
      ];
    });
}

/** Only observed pagination widgets; never a generic link/button text search. */
export function nextPageTarget(document: Document, href: string): HTMLElement | undefined {
  allowedPage(document, href);
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '.options-pages a.next,.page-next,.pagination-next,.pagination .next,.s-pagination__next,.pagination [aria-label="下一页"],.pagination button[aria-label="Next page"]',
    ),
  ).find(
    (e) =>
      visible(e) &&
      !e.matches('[disabled],[aria-disabled="true"],.disabled,.is-disabled') &&
      !e.closest('[aria-disabled="true"],.disabled,.is-disabled') &&
      !e.closest('.job-detail-modules'),
  );
}

/** Zhilian's observed split list appends another 20 cards when its bottom becomes visible. */
export function loadMoreTarget(document: Document, href: string): HTMLElement | undefined {
  const url = allowedPage(document, href);
  if (boss(url)) return;
  const panel = Array.from(
    document.querySelectorAll('.job-split-layout__left .job-list-panel'),
  ).find(visible);
  if (!panel || listExhausted(document, href)) return;
  return Array.from(panel.querySelectorAll<HTMLElement>(':scope > .job-card'))
    .filter(visible)
    .at(-1);
}

/** Only the observed Zhilian list-end status proves that scrolling has finished. */
export function listExhausted(document: Document, href: string): boolean {
  const url = allowedPage(document, href);
  if (boss(url)) return false;
  const panels = Array.from(
    document.querySelectorAll('.job-split-layout__left .job-list-panel'),
  ).filter(visible);
  if (panels.length !== 1) return false;
  const status = panels[0].lastElementChild;
  return !!(
    status?.matches('.job-list-panel__status.job-list-panel__status--more') &&
    visible(status) &&
    status.textContent?.replace(/\s+/g, '') === '没有更多了'
  );
}

function detailObservation(
  root: ParentNode,
  url: URL,
  document: Document,
): Observation | undefined {
  const isBoss = boss(url);
  const title = isBoss ? bossTitle(root) : detailText(root, '.job-detail-summary__title-text');
  const description = detailText(
    root,
    isBoss ? BOSS_DESCRIPTION : '.job-description__content',
    true,
  );
  if (!title || !description) return;
  let company = detailText(
    root,
    isBoss
      ? '.sider-company .company-info a,.sider-company .company-name,.company-name,.company-info a'
      : '.job-detail-summary__company-name',
  );
  let target = jobId(url) ? url : (detailLink(root, url, title) ?? url);
  // A selected card can supply its company/link only after title identity is checked.
  const targets = listTargets(document, url.href);
  const matched = jobId(target)
    ? targets.filter(
        (t) =>
          t.platform_job_id === jobId(target) &&
          t.title.replace(/\s/g, '') === title.replace(/\s/g, ''),
      )
    : [];
  if (!company && matched.length === 1) company = matched[0].company;
  const selected = targets.filter(
    (t) =>
      t.element.matches('.active,.selected,.is-active,.job-card--active,.job-card-active') ||
      t.element.getAttribute('aria-selected') === 'true',
  );
  if (
    selected.length === 1 &&
    (selected[0].title.replace(/\s/g, '') !== title.replace(/\s/g, '') ||
      (company &&
        selected[0].company &&
        company.replace(/\s/g, '') !== selected[0].company.replace(/\s/g, '')))
  )
    throw new Error('左侧已切换职位，右侧详情仍在加载，请稍后重试');
  if (selected.length === 1 && selected[0].title.replace(/\s/g, '') === title.replace(/\s/g, '')) {
    if (!company) company = selected[0].company;
    if (!jobId(target) && selected[0].platform_job_id) target = new URL(selected[0].key);
  }
  const salary = text(root, isBoss ? '.salary,.job-salary' : '.job-detail-summary__salary');
  const renderedSalary = /[\uE000-\uF8FF]/.test(salary) ? '薪资采用特殊字体，待核对' : salary;
  const requirements = isBoss
    ? text(root, '.job-banner .info-primary p,.job-info,.job-limit', true)
    : Array.from(root.querySelectorAll('.job-detail-summary__tag'))
        .filter(visible)
        .map((e) => e.textContent?.trim())
        .filter(Boolean)
        .join(' · ');
  const city = isBoss
    ? text(root, '.job-area,.job-location,.job-limit a')
    : text(root, '.job-detail-summary__tag');
  const tags = text(root, isBoss ? '.job-tags,.tag-list' : '.job-description__tags', true);
  return {
    ...base,
    city: redact(city.split(/[·\s]/)[0]).slice(0, 60),
    url: target.origin + target.pathname,
    title: redact(title).slice(0, 160),
    company: redact(company).slice(0, 160),
    text: redact(
      [title, renderedSalary, requirements, description, tags].filter(Boolean).join('\n'),
    ).slice(0, 20000),
    platform_job_id: jobId(target),
    page_kind: 'detail',
  };
}

export function observeSelection(
  document: Document,
  href: string,
  selection: string,
): Observation[] {
  const url = allowedPage(document, href);
  const excerpt = selection.trim();
  if (excerpt.length < 20)
    throw new Error('请先在招聘页选中职位标题和描述（至少 20 个字），再点此处读取');
  if (excerpt.length > 20000) throw new Error('所选文字太长，请只选择一个岗位的标题和描述');
  return [
    {
      ...base,
      url: url.origin + url.pathname,
      title: redact(
        excerpt
          .split(/[\r\n]/)
          .find((l) => l.trim())!
          .trim(),
      ).slice(0, 160),
      company: '',
      text: redact(excerpt),
      platform_job_id: jobId(url),
      page_kind: 'unknown',
    },
  ];
}

/** Structure-only diagnostics: never return page text, HTML, attributes or URL query values. */
export function diagnosePage(document: Document, href: string) {
  const url = new URL(href);
  if (
    url.protocol !== 'https:' ||
    !RECRUITING_HOSTS.includes(url.hostname) ||
    url.username ||
    url.password ||
    /\/chat(?:\/|$)|\/passport(?:\/|$)|\/user(?:\/|$)|\/login|\/resume(?:\/|$)/i.test(url.pathname)
  )
    throw new Error('仅诊断招聘网站的职位页面结构');
  const selectors = (
    boss(url)
      ? `${BOSS_ROOTS},${BOSS_TITLE},.job-title,${BOSS_DESCRIPTION},${JOB_CARDS},${JOB_LISTS}`
      : '.job-detail-modules,.job-detail-summary__title-text,.job-description__content,.job-card,.job-list-panel'
  ).split(',');
  const counts = Object.fromEntries(
    [...new Set(selectors)].map((selector) => {
      const matches = Array.from(document.querySelectorAll(selector));
      return [selector, { total: matches.length, visible: matches.filter(visible).length }];
    }),
  );
  const describe = (element: Element) => ({
    tag: element.tagName.toLowerCase(),
    className: (element.getAttribute('class') ?? '')
      .split(/\s+/)
      .filter((value) => /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(value))
      .slice(0, 8)
      .join(' '),
    textLength: element.textContent?.length ?? 0,
  });
  const headings = Array.from(
    document.querySelectorAll(
      'h1,h2,h3,h4,h5,h6,[class*="title"],[class*="heading"],[role="heading"]',
    ),
  )
    .filter((element) => visible(element) && element.textContent?.trim() === '职位描述')
    .slice(0, 5);
  return {
    pagePath: url.pathname,
    selectors: counts,
    descriptionHeadings: headings.flatMap((heading) => {
      const parent = heading.parentElement;
      if (!parent) return [];
      const ancestors = [];
      for (
        let ancestor = parent.parentElement;
        ancestor && ancestors.length < 4;
        ancestor = ancestor.parentElement
      )
        ancestors.push(describe(ancestor));
      return [
        {
          parent: {
            ...describe(parent),
            children: Array.from(parent.children)
              .slice(0, 8)
              .map((child) => ({
                ...describe(child),
                children: Array.from(child.children).slice(0, 8).map(describe),
              })),
          },
          ancestors,
        },
      ];
    }),
    titleNodes: elements(document, boss(url) ? BOSS_TITLE : '.job-detail-summary__title-text')
      .filter(outsideCard)
      .slice(0, 6)
      .map(describe),
    listSurroundings: elements(document, JOB_LISTS)
      .slice(0, 3)
      .map((list) => ({
        ...describe(list),
        tail: Array.from(list.children).slice(-3).map(describe),
        parent: list.parentElement
          ? {
              ...describe(list.parentElement),
              children: Array.from(list.parentElement.children)
                .slice(-6)
                .map((child) => ({
                  ...describe(child),
                  children: Array.from(child.children).slice(-4).map(describe),
                })),
            }
          : undefined,
      })),
  };
}

export function observe(document: Document, href: string): Observation[] {
  const url = allowedPage(document, href);
  const isBoss = boss(url);
  const roots = Array.from(
    document.querySelectorAll(isBoss ? BOSS_ROOTS : '.job-detail-modules'),
  ).filter(visible);
  const isolatedRoots: Element[] = [];
  if (isBoss)
    for (const description of document.querySelectorAll(BOSS_DESCRIPTION)) {
      if (!visible(description) || !outsideCard(description)) continue;
      for (
        let node = description.parentElement;
        node && node !== document.body;
        node = node.parentElement
      ) {
        if (elements(node, JOB_LISTS).length) break;
        if (bossTitle(node)) {
          if (!isolatedRoots.includes(node)) isolatedRoots.push(node);
          break;
        }
      }
    }
  for (const root of [...isolatedRoots, ...roots]) {
    if (elements(root, JOB_LISTS).length) continue;
    const observation = detailObservation(root, url, document);
    if (observation) return [observation];
  }
  // On standalone detail pages the title and description share the document, not the list.
  if (jobId(url)) {
    const observation = elements(document, JOB_LISTS).length
      ? undefined
      : detailObservation(document, url, document);
    if (observation) return [observation];
    throw new Error('未找到可验证的职位标题或描述，可能页面已改版；请手动粘贴');
  }
  if (roots.length || /job-recommend/.test(url.pathname)) {
    const loading = roots.some(
      (root) =>
        elements(root, '[aria-busy="true"],[role="progressbar"],.loading,.is-loading,.skeleton')
          .length > 0,
    );
    throw new Error(
      loading
        ? '右侧职位详情尚未完整加载，请选中职位稍后重试'
        : '当前职位页面布局暂未识别，请使用“读取选中的职位文字”或在工作台粘贴职位',
    );
  }
  const targets = listTargets(document, href);
  const observations = targets.slice(0, 20).flatMap((t) => {
    if (!t.platform_job_id) return [];
    const salary = text(t.element, isBoss ? '.salary,.job-salary' : '.job-card__salary');
    const content = [
      t.title,
      /[\uE000-\uF8FF]/.test(salary) ? '薪资采用特殊字体，待核对' : salary,
      text(t.element, isBoss ? '.tag-list' : '.job-card__skill-tags'),
    ]
      .filter(Boolean)
      .join('\n');
    return [
      {
        ...base,
        url: t.key,
        title: redact(t.title).slice(0, 160),
        company: redact(t.company).slice(0, 160),
        text: redact(content).slice(0, 20000),
        platform_job_id: t.platform_job_id,
        page_kind: 'list' as const,
      },
    ];
  });
  if (!observations.length)
    throw new Error('当前页没有支持的职位卡片或右侧详情，请选中职位或在工作台粘贴原文');
  return observations;
}
