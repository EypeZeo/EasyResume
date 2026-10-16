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

function text(root: ParentNode, selectors: string): string {
  return (
    Array.from(root.querySelectorAll(selectors))
      .find(visible)
      ?.textContent?.trim()
      .replace(/\s+/g, ' ') ?? ''
  );
}

function redact(value: string): string {
  return value
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[手机号已省略]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[邮箱已省略]')
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, '[身份证号已省略]');
}

function visible(element: Element): boolean {
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

function allowedPage(document: Document, href: string): URL {
  const url = new URL(href);
  if (url.protocol !== 'https:' || !['www.zhipin.com', 'zhipin.com'].includes(url.hostname))
    throw new Error('仅支持当前BOSS职位页');
  if (/\/web\/geek\/chat|\/web\/passport(?:\/|$)|\/user\/|\/login/.test(url.pathname))
    throw new Error('不读取聊天、登录或个人资料页面');
  const visibleChallenge = Array.from(
    document.querySelectorAll('[class*="captcha"], #captcha, [class*="geetest"]'),
  ).some(
    (element) =>
      visible(element) &&
      (!!element.textContent?.trim() || !!element.querySelector('iframe, canvas, input, img')),
  );
  const warnings = Array.from(
    document.querySelectorAll('[role="alert"], .verify-page, .error-page'),
  )
    .filter(visible)
    .map((element) => element.textContent?.slice(0, 300) ?? '')
    .join(' ');
  if (visibleChallenge || /请完成验证|安全验证|访问异常|账号异常/.test(document.title + warnings))
    throw new Error('检测到验证或异常，请处理后手动重试');
  return url;
}

function detailObservation(root: ParentNode, url: URL): Observation | undefined {
  const title = text(root, '.job-name, .name h1, .job-title h1, h1, .job-title');
  const description = text(root, '.job-sec-text, .job-detail-section .text, .job-description');
  if (!title || !description) return;
  const company = text(
    root,
    '.sider-company .company-info a, .sider-company .company-name, .company-name, .company-info a',
  );
  const parts = [
    title,
    text(root, '.salary, .job-salary'),
    text(root, '.job-banner .info-primary p, .job-info'),
    description,
    text(root, '.job-tags, .tag-list'),
  ];
  return {
    protocol: 1,
    city: '',
    employment_type: 'unknown',
    recruitment_type: 'unknown',
    blocked: false,
    url: url.origin + url.pathname,
    title: redact(title).slice(0, 160),
    company: redact(company).slice(0, 160),
    text: redact(parts.filter(Boolean).join('\n')).slice(0, 20000),
    platform_job_id: url.pathname.match(/\/job_detail\/([^/.]+)/)?.[1] ?? '',
    page_kind: 'detail',
  };
}

/** A user-selected excerpt is an explicit fallback, never a whole-page scrape. */
export function observeSelection(
  document: Document,
  href: string,
  selection: string,
): Observation[] {
  const url = allowedPage(document, href);
  if (!/\/job_detail\/|^\/web\/geek\/jobs?(?:[-/]|$)/.test(url.pathname))
    throw new Error('请在职位列表或详情页选择职位文字');
  const excerpt = selection.trim();
  if (excerpt.length < 20)
    throw new Error('请先在招聘页选中职位标题和描述（至少 20 个字），再点此处读取');
  if (excerpt.length > 20000) throw new Error('所选文字太长，请只选择一个岗位的标题和描述');
  const title = excerpt
    .split(/[\r\n]/)
    .find((line) => line.trim())!
    .trim();
  return [
    {
      protocol: 1,
      city: '',
      employment_type: 'unknown',
      recruitment_type: 'unknown',
      blocked: false,
      url: url.origin + url.pathname,
      title: redact(title).slice(0, 160),
      company: '',
      text: redact(excerpt),
      platform_job_id: url.pathname.match(/\/job_detail\/([^/.]+)/)?.[1] ?? '',
      page_kind: 'unknown',
    },
  ];
}

export function observe(document: Document, href: string): Observation[] {
  const url = allowedPage(document, href);
  const base = {
    protocol: 1 as const,
    city: '',
    employment_type: 'unknown' as const,
    recruitment_type: 'unknown' as const,
    blocked: false,
  };
  if (/\/job_detail\//.test(url.pathname)) {
    const detail = detailObservation(document, url);
    if (!detail)
      throw new Error('未找到可验证的职位标题或描述，可能页面已改版；请手动粘贴，不扩大读取范围');
    return [detail];
  }
  if (/^\/web\/geek\/job-recommend(?:\/|$)/.test(url.pathname)) {
    // Isolated, allowlisted detail containers only. Do not combine a left card with a right description.
    // Logged-in recommendation DOM still requires separate real-platform validation.
    for (const root of document.querySelectorAll(
      '.job-detail-box, .job-detail-container, .job-detail-content',
    )) {
      if (!visible(root) || root.querySelector('.job-card-wrapper, .job-list-box')) continue;
      const detail = detailObservation(root, url);
      if (detail) return [detail];
    }
    throw new Error(
      '未识别推荐页的当前职位详情。请在右侧选中标题和描述，使用“读取选中的职位文字”，或复制到工作台导入。',
    );
  }
  const cards = Array.from(
    document.querySelectorAll('.job-card-wrapper, .job-list-box .job-card-body'),
  ).slice(0, 20);
  const jobs = cards.flatMap((card) => {
    const link = card.querySelector<HTMLAnchorElement>('a[href*="/job_detail/"]');
    const title = text(card, '.job-name, .job-title');
    if (!link || !title) return [];
    const target = new URL(link.getAttribute('href')!, url.origin);
    if (!['www.zhipin.com', 'zhipin.com'].includes(target.hostname)) return [];
    const company = text(card, '.company-name');
    const parts = [
      title,
      text(card, '.salary'),
      text(card, '.tag-list'),
      text(card, '.job-card-footer .info-desc, .job-card-footer .tag-list'),
    ];
    return [
      {
        ...base,
        url: target.origin + target.pathname,
        title: redact(title).slice(0, 160),
        company: redact(company).slice(0, 160),
        text: redact(parts.filter(Boolean).join('\n')).slice(0, 20000),
        platform_job_id: target.pathname.match(/\/job_detail\/([^/.]+)/)?.[1] ?? '',
        page_kind: 'list' as const,
      },
    ];
  });
  if (!jobs.length) throw new Error('当前页没有支持的职位卡片；请打开职位详情，或在工作台粘贴原文');
  return jobs;
}
