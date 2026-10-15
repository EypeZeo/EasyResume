// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { localServer, observe } from './observe';

describe('local-only pairing URL', () => {
  it('accepts only loopback root addresses', () => {
    expect(localServer('http://127.0.0.1:8765')).toBe('http://127.0.0.1:8765');
    for (const url of [
      'https://evil.example',
      'http://127.0.0.1.evil.example',
      'http://127.0.0.1:8765/path',
      'http://user:secret@127.0.0.1',
    ])
      expect(() => localServer(url)).toThrow();
  });
});

describe('synthetic BOSS DOM, not a real compatibility claim', () => {
  it('extracts detail fields without HR card or full page', () => {
    document.title = '合成职位';
    document.body.innerHTML =
      '<h1 class="job-name">Python开发</h1><div class="salary">10-15K</div><div class="company-name">合成公司</div><div class="job-sec-text">本科，Python，双休</div><div class="boss-info">合成HR姓名 不应提取</div>';
    const result = observe(
      document,
      'https://www.zhipin.com/job_detail/synthetic.html?tracking=secret',
    )[0];
    expect(result.title).toBe('Python开发');
    expect(result.text).toContain('双休');
    expect(result.text).not.toContain('HR姓名');
    expect(result.url).not.toContain('tracking');
    expect(result.platform_job_id).toBe('synthetic');
  });
  it('fails closed on unknown DOM or verification', () => {
    document.title = '安全验证';
    document.body.innerHTML = '';
    expect(() => observe(document, 'https://www.zhipin.com/job_detail/synthetic.html')).toThrow(
      '验证',
    );
    document.title = '职位';
    document.body.innerHTML = '<p>unsupported markup</p>';
    expect(() => observe(document, 'https://www.zhipin.com/job_detail/synthetic.html')).toThrow(
      '改版',
    );
  });
  it('never reads chats or other sites', () => {
    expect(() => observe(document, 'https://www.zhipin.com/web/geek/chat')).toThrow('聊天');
    expect(() => observe(document, 'https://evil.example')).toThrow('BOSS');
  });
  it('extracts visible list cards without following links', () => {
    document.title = '合成列表';
    document.body.innerHTML =
      '<div class="job-card-wrapper"><a href="/job_detail/abc.html"><span class="job-name">合成数据岗位</span></a><span class="company-name">合成企业</span><span class="salary">8-12K</span><div class="tag-list">本科 双休</div><div class="boss-info">合成招聘者</div></div>';
    const result = observe(document, 'https://www.zhipin.com/web/geek/job');
    expect(result).toHaveLength(1);
    expect(result[0].page_kind).toBe('list');
    expect(result[0].text).not.toContain('招聘者');
  });
});
