// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { listTargets, localServer, observe, observeSelection, loadMoreTarget } from './observe';

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

describe('split-pane job identity and text boundaries', () => {
  it('supports BOSS job-card-box and associates the current company by exact detail ID', () => {
    document.title = '合成BOSS分栏';
    document.body.innerHTML = `<ul class="job-list-container"><li class="job-card-box"><a href="/job_detail/current-id.html"><span class="job-name">合成运维</span></a><div class="company-name">合成对应公司</div><span class="job-salary">8-10K</span></li><li class="job-card-box"><a href="/job_detail/other-id.html"><span class="job-name">同列表其他职位</span></a><div class="company-name">不应误用的公司</div></li></ul><section class="job-detail-box"><h1 class="job-name">合成运维</h1><div class="job-sec-text">维护Linux服务器，周末双休。</div><a href="/job_detail/current-id.html">查看更多信息</a></section>`;
    const result = observe(document, 'https://www.zhipin.com/web/geek/jobs')[0];
    expect(listTargets(document, 'https://www.zhipin.com/web/geek/jobs')).toHaveLength(2);
    expect(result.company).toBe('合成对应公司');
    expect(result.platform_job_id).toBe('current-id');
    expect(result.text).not.toContain('同列表其他职位');
  });
  it('reads Zhilian right detail and its own stable job link, without list or HR text', () => {
    document.title = '合成智联列表';
    document.body.innerHTML = `<div class="job-split-layout__left"><div class="job-list-panel"><div class="job-card job-card--active"><div class="job-card__title-main">合成数据库运维</div><a class="job-card__company-name">合成乙公司</a></div><div class="job-card"><div class="job-card__title-main">左侧其他职位</div><a class="job-card__company-name">合成甲公司</a></div></div></div>
      <div class="job-detail-modules"><h1 class="job-detail-summary__title"><span class="job-detail-summary__title-text">合成数据库运维</span><span class="job-detail-summary__salary">6000-7000元</span></h1><a class="job-detail-summary__company-name">合成乙公司</a><ul><li class="job-detail-summary__tag">郑州·金水区</li><li class="job-detail-summary__tag">本科</li></ul><div class="job-description__content">维护MySQL<br>周末双休</div><div class="job-detail-publisher-card">不应读取的HR姓名</div><a href="https://www.zhaopin.com/jobdetail/SYNTHETIC.htm?tracking=secret">查看更多职位信息</a></div>`;
    const result = observe(document, 'https://www.zhaopin.com/jobs/?pageMode=recommend');
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('合成数据库运维');
    expect(result[0].company).toBe('合成乙公司');
    expect(result[0].platform_job_id).toBe('SYNTHETIC');
    expect(result[0].city).toBe('郑州');
    expect(result[0].text).toContain('维护MySQL\n周末双休');
    expect(result[0].text).not.toMatch(/其他职位|HR姓名|secret/);
    expect(listTargets(document, 'https://www.zhaopin.com/jobs/')).toHaveLength(2);
    expect(loadMoreTarget(document, 'https://www.zhaopin.com/jobs/')?.textContent).toContain(
      '左侧其他职位',
    );
  });
  it('finds a BOSS right detail on /jobs without mixing another card or inventing salary digits', () => {
    document.title = '合成BOSS';
    document.body.innerHTML = `<aside class="job-list-box"><div class="job-card-wrapper"><a href="/job_detail/other.html"><span class="job-name">其他岗位</span></a></div></aside><section class="job-detail-box"><h1 class="job-name">合成系统运维</h1><span class="salary">\ue031-\ue039K</span><p class="company-name">合成公司</p><div class="job-sec-text">负责系统维护<br>本科及以上</div><a href="/job_detail/current.html">查看更多信息</a></section>`;
    const result = observe(document, 'https://www.zhipin.com/web/geek/jobs?city=101180100')[0];
    expect(result.title).toBe('合成系统运维');
    expect(result.platform_job_id).toBe('current');
    expect(result.text).toContain('薪资采用特殊字体，待核对');
    expect(result.text).not.toMatch(/[\uE000-\uF8FF]|其他岗位/);
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
    expect(() => observe(document, 'https://www.zhipin.com/web/passport/safe/verify')).toThrow(
      '登录',
    );
    expect(() =>
      observeSelection(document, 'https://www.zhipin.com/web/passport/safe/verify', 'a'.repeat(30)),
    ).toThrow('登录');
  });
  it('ignores inactive hidden verification widgets but stops at visible ones', () => {
    document.title = '合成职位';
    document.body.innerHTML =
      '<h1 class="job-name">合成运维职位</h1><div class="job-sec-text">合成职位描述</div><div style="display:none"><div id="captcha">请完成验证</div></div>';
    expect(observe(document, 'https://www.zhipin.com/job_detail/synthetic.html')).toHaveLength(1);
    document.querySelector('#captcha')!.parentElement!.style.display = 'block';
    expect(() => observe(document, 'https://www.zhipin.com/job_detail/synthetic.html')).toThrow(
      '验证',
    );
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
  it('reads an isolated recommendation detail without a job link and never mixes left cards', () => {
    document.title = '合成推荐页';
    document.body.innerHTML =
      '<aside class="job-list-box"><div class="job-card-wrapper"><span class="job-name">左侧其他职位</span><span class="company-name">左侧其他公司</span><span class="salary">40-60K</span></div></aside><section class="job-detail-box"><h1 class="job-name">右侧当前职位</h1><span class="company-name">右侧当前公司</span><span class="salary">8-12K</span><div class="job-sec-text">当前岗位要求 Linux 运维与网络基础</div><div class="boss-info">不应读取的招聘者</div></section>';
    const result = observe(document, 'https://www.zhipin.com/web/geek/job-recommend?ka=tracking');
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('右侧当前职位');
    expect(result[0].company).toBe('右侧当前公司');
    expect(result[0].text).not.toMatch(/左侧|40-60K|招聘者/);
    expect(result[0].platform_job_id).toBe('');
    expect(result[0].url).toBe('https://www.zhipin.com/web/geek/job-recommend');
  });
  it('does not borrow a left-hand title when recommendation detail is incomplete', () => {
    document.title = '合成推荐页';
    document.body.innerHTML =
      '<div class="job-card-wrapper"><span class="job-name">左侧职位</span></div><section class="job-detail-box"><div class="job-sec-text">右侧描述但没有标题</div></section>';
    expect(() => observe(document, 'https://www.zhipin.com/web/geek/job-recommend')).toThrow(
      '选中',
    );
  });
  it('ignores a hidden previous detail when the recommendation page retains old DOM', () => {
    document.title = '合成推荐页';
    document.body.innerHTML =
      '<section class="job-detail-box" hidden><h1>旧岗位</h1><div class="job-sec-text">旧岗位描述</div></section><section class="job-detail-box"><h1>当前岗位</h1><div class="job-sec-text">当前岗位描述</div></section>';
    const result = observe(document, 'https://www.zhipin.com/web/geek/job-recommend');
    expect(result[0].title).toBe('当前岗位');
    expect(result[0].text).not.toContain('旧岗位');
  });
  it('allows an explicit selected excerpt without collecting surrounding page text', () => {
    document.title = '合成推荐页';
    document.body.innerHTML = '<p>不应读取的页面姓名与聊天</p>';
    const result = observeSelection(
      document,
      'https://www.zhipin.com/web/geek/job-recommend',
      '合成 Linux 运维\n维护服务器和虚拟化环境，周末双休，需要网络基础。',
    );
    expect(result[0].title).toBe('合成 Linux 运维');
    expect(result[0].company).toBe('');
    expect(result[0].platform_job_id).toBe('');
    expect(result[0].page_kind).toBe('unknown');
    expect(result[0].text).not.toContain('页面姓名');
    expect(() =>
      observeSelection(document, 'https://www.zhipin.com/web/geek/job-recommend', ''),
    ).toThrow('先');
    expect(() =>
      observeSelection(document, 'https://www.zhipin.com/web/geek/chat', 'a'.repeat(30)),
    ).toThrow('聊天');
    expect(() => observeSelection(document, 'https://www.zhipin.com/', 'a'.repeat(30))).toThrow(
      '职位列表',
    );
  });
});
