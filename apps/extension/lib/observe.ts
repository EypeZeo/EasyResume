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
  return root.querySelector(selectors)?.textContent?.trim().replace(/\s+/g, ' ') ?? '';
}

function redact(value: string): string {
  return value
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[手机号已省略]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[邮箱已省略]')
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, '[身份证号已省略]');
}

export function observe(document: Document, href: string): Observation[] {
  const url = new URL(href);
  if (url.protocol !== 'https:' || !['www.zhipin.com', 'zhipin.com'].includes(url.hostname))
    throw new Error('仅支持当前BOSS职位页');
  if (/\/web\/geek\/chat|\/user\/|\/login/.test(url.pathname))
    throw new Error('不读取聊天、登录或个人资料页面');
  if (
    document.querySelector('[class*="captcha"], #captcha') ||
    /请完成验证|安全验证|访问异常|账号异常/.test(
      document.title + (document.body?.textContent ?? '').slice(0, 300),
    )
  )
    throw new Error('检测到验证或异常，请处理后手动重试');
  const base = {
    protocol: 1 as const,
    city: '',
    employment_type: 'unknown' as const,
    recruitment_type: 'unknown' as const,
    blocked: false,
  };
  if (/\/job_detail\//.test(url.pathname)) {
    const title = text(document, '.job-name, .name h1, .job-title h1, h1');
    const company = text(
      document,
      '.sider-company .company-info a, .sider-company .company-name, .company-name, .company-info a',
    );
    const description = text(
      document,
      '.job-sec-text, .job-detail-section .text, .job-description',
    );
    if (!title || !description)
      throw new Error('未找到可验证的职位标题或描述，可能页面已改版；请手动粘贴，不扩大读取范围');
    const parts = [
      title,
      text(document, '.salary, .job-salary'),
      text(document, '.job-banner .info-primary p, .job-info'),
      description,
      text(document, '.job-tags, .tag-list'),
    ];
    return [
      {
        ...base,
        url: url.origin + url.pathname,
        title: redact(title).slice(0, 160),
        company: redact(company).slice(0, 160),
        text: redact(parts.filter(Boolean).join('\n')).slice(0, 20000),
        platform_job_id: url.pathname.match(/\/job_detail\/([^/.]+)/)?.[1] ?? '',
        page_kind: 'detail',
      },
    ];
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
