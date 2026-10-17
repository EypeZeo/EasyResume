// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  diagnosePage,
  listExhausted,
  listTargets,
  localServer,
  observe,
  observeSelection,
  loadMoreTarget,
} from './observe';

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
  it('distinguishes an empty Zhaopin detail response from an unsupported layout', () => {
    document.title = '合成智联职位';
    document.body.innerHTML =
      '<div class="job-card"><span class="job-card__title-clamp">合成岗位</span></div><div class="job-detail-modules"></div>';
    expect(() => observe(document, 'https://www.zhaopin.com/jobs/')).toThrow('右侧职位详情为空');
  });
  it('gets a missing city only from the card with the matching job ID and title', () => {
    document.title = '合成职位列表';
    document.body.innerHTML = `<ul class="job-list-container"><li class="job-card-box"><a class="job-name" href="/job_detail/other.html">同名运维职位</a><span class="company-location">北京·海淀区·合成街道</span></li><li class="job-card-box"><a class="job-name" href="/job_detail/current.html">同名运维职位</a><span class="company-location">郑州·中原区·合成街道</span></li></ul><section class="job-detail-box"><span class="job-name">同名运维职位</span><div class="job-sec-text">维护服务器。</div><a href="/job_detail/current.html">查看更多信息</a></section>`;
    const result = observe(document, 'https://www.zhipin.com/web/geek/jobs')[0];
    expect(result.city).toBe('郑州');
    expect(listTargets(document, 'https://www.zhipin.com/web/geek/jobs')[1].city).toBe('郑州');
    document
      .querySelector('a[href="/job_detail/current.html"]')!
      .setAttribute('href', '/job_detail/different.html');
    expect(observe(document, 'https://www.zhipin.com/web/geek/jobs')[0].city).toBe('');
  });
  it('preserves a detail city instead of replacing it with the matched card city', () => {
    document.title = '合成职位列表';
    document.body.innerHTML = `<li class="job-card-box"><a class="job-name" href="/job_detail/current.html">当前运维职位</a><span class="company-location">郑州·中原区·合成街道</span></li><section class="job-detail-box"><span class="job-name">当前运维职位</span><span class="job-location">上海·浦东新区·合成街道</span><div class="job-sec-text">维护服务器。</div><a href="/job_detail/current.html">查看更多信息</a></section>`;
    expect(observe(document, 'https://www.zhipin.com/web/geek/jobs')[0].city).toBe('上海');
  });
  it('can use a uniquely selected same-title card and does not infer a city from its surrounding text', () => {
    document.title = '合成职位列表';
    document.body.innerHTML = `<div class="job-card-wrapper active"><span class="job-name">当前运维职位</span><span class="company-location">郑州·中原区·合成街道</span><span>深圳是原文中无关的地点</span></div><section class="job-detail-box"><span class="job-name">当前运维职位</span><div class="job-sec-text">维护服务器。</div></section>`;
    expect(observe(document, 'https://www.zhipin.com/web/geek/jobs')[0].city).toBe('郑州');
    document.querySelector('.company-location')!.setAttribute('hidden', '');
    expect(observe(document, 'https://www.zhipin.com/web/geek/jobs')[0].city).toBe('');
  });
  it('rejects a selected same-title card whose stable ID differs from the current detail', () => {
    document.title = '合成职位列表';
    document.body.innerHTML = `<li class="job-card-box active"><a class="job-name" href="/job_detail/new-selection.html">同名运维职位</a><span class="company-location">北京·海淀区</span></li><section class="job-detail-box"><span class="job-name">同名运维职位</span><div class="job-sec-text">旧职位的描述。</div><a href="/job_detail/old-detail.html">查看更多信息</a></section>`;
    expect(() => observe(document, 'https://www.zhipin.com/web/geek/jobs')).toThrow(
      '左侧已切换职位',
    );
  });
  it('associates observed company links by exact job ID even when two cards have the same title', () => {
    document.title = '脱敏BOSS职位列表';
    document.body.innerHTML = `<ul class="job-list-container"><li class="job-card-box"><a class="job-name" href="/job_detail/first.html">同名运维职位</a><a class="boss-info" href="/gongsi/company-one.html">合成第一公司</a></li><li class="job-card-box"><a class="job-name" href="/job_detail/second.html">同名运维职位</a><a class="boss-info" href="/gongsi/company-two.html">合成第二公司</a></li></ul><section class="job-detail-box"><span class="job-name">同名运维职位</span><div class="job-detail-body"><p class="desc">维护Linux服务器与网络设备。</p></div><a class="more-job-btn" href="/job_detail/second.html">查看更多职位信息</a></section>`;
    const result = observe(document, 'https://www.zhipin.com/web/geek/jobs')[0];
    expect(result.platform_job_id).toBe('second');
    expect(result.company).toBe('合成第二公司');
    expect(
      listTargets(document, 'https://www.zhipin.com/web/geek/jobs').map((target) => target.company),
    ).toEqual(['合成第一公司', '合成第二公司']);
  });
  it('can obtain company metadata from a verified parent detail but never from its related card', () => {
    document.title = '合成职位';
    document.body.innerHTML = `<section class="job-detail-box"><article class="job-detail-container"><h1 class="job-name">当前网络运维</h1><div class="job-sec-text">维护网络设备。</div><a href="/job_detail/current.html">查看更多信息</a></article><a href="/gongsi/main.html">合成主公司</a><div class="job-card-wrapper"><a class="job-name" href="/job_detail/related.html">旁边的职位</a><span class="company-name">不应借用的旁边公司</span></div></section>`;
    const result = observe(document, 'https://www.zhipin.com/web/geek/jobs')[0];
    expect(result.company).toBe('合成主公司');
    expect(result.platform_job_id).toBe('current');
    expect(result.text).not.toContain('旁边');
  });
  it('does not borrow a company from a parent containing another independent detail', () => {
    document.title = '合成职位';
    document.body.innerHTML = `<section class="job-detail-box"><article class="job-detail-container"><h1 class="job-name">当前运维职位</h1><div class="job-sec-text">当前职位的描述。</div><a href="/job_detail/current.html">查看更多信息</a></article><article class="job-detail-container"><h1 class="job-name">另一运维职位</h1><div class="job-sec-text">另一职位的描述。</div><span class="company-name">另一职位的公司</span></article></section>`;
    const result = observe(document, 'https://www.zhipin.com/web/geek/jobs')[0];
    expect(result.platform_job_id).toBe('current');
    expect(result.company).toBe('');
  });
  it('keeps company unknown for valid job IDs when only hidden company and HR links are present', () => {
    document.title = '合成职位列表';
    document.body.innerHTML = `<ul class="job-list-container"><li class="job-card-box"><a class="job-name" href="/job_detail/current.html">当前运维职位</a><a hidden class="boss-info" href="/gongsi/hidden.html">隐藏的公司名称</a><a class="boss-info" href="/web/geek/chat">不应作为公司的招聘者姓名</a></li><li class="job-card-box"><a class="job-name" href="/job_detail/other.html">其他运维职位</a><span class="boss-name">另一招聘者姓名</span></li></ul><section class="job-detail-box"><span class="job-name">当前运维职位</span><div class="job-sec-text">维护服务器。</div><a href="/job_detail/current.html">查看更多信息</a></section>`;
    const result = observe(document, 'https://www.zhipin.com/web/geek/jobs')[0];
    expect(result.platform_job_id).toBe('current');
    expect(result.company).toBe('');
    const diagnostics = diagnosePage(
      document,
      'https://www.zhipin.com/web/geek/jobs?secret=private',
    );
    expect(diagnostics.listCards).toHaveLength(2);
    expect(
      diagnostics.listCards.every((card) => card.hasStableJobId && card.companyLength === 0),
    ).toBe(true);
    expect(diagnostics.listCards[0].links.map((link) => link.pathKind)).toEqual([
      'job_detail',
      'other',
    ]);
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /隐藏的公司名称|招聘者姓名|current\.html|gongsi\/hidden|secret|private/,
    );
  });
  it('does not choose between multiple different company links inside one card', () => {
    document.title = '合成职位列表';
    document.body.innerHTML = `<li class="job-card-box"><a class="job-name" href="/job_detail/current.html">当前运维职位</a><a href="/gongsi/first.html">合成甲公司</a><a href="/gongsi/second.html">合成乙公司</a></li>`;
    expect(listTargets(document, 'https://www.zhipin.com/web/geek/jobs')[0].company).toBe('');
  });
  it('reads the observed BOSS split detail shape without styles, hidden text, publisher or address', () => {
    document.title = '脱敏BOSS职位列表';
    document.body.innerHTML = `<aside class="job-list-box"><div class="job-card-wrapper active"><span class="job-name">合成网络运维</span><span class="company-name">合成企业</span><a href="/job_detail/current.html">详情</a></div></aside><section class="job-detail-box"><div class="job-detail-container"><div class="job-title"><span class="job-name">合成网络运维</span><span class="salary">6-8K</span></div><div class="job-detail-body"><h3 class="title">职位描述</h3><p class="desc"><style>.SyntheticRandom { color: red; } /* 不应读取的样式 */</style><span class="SyntheticRandom">维护 Linux 服务器。</span><span hidden>不应读取的隐藏文字</span><br><span class="AnotherRandom">要求网络基础与故障排查。</span></p></div><div class="job-detail-operate">不应读取的分享操作</div><div class="job-boss-info">不应读取的招聘者姓名</div><div class="job-address">不应读取的详细地址</div><a class="more-job-btn" href="/job_detail/current.html">查看更多职位信息</a></div></section>`;
    const result = observe(document, 'https://www.zhipin.com/web/geek/jobs')[0];
    expect(result.title).toBe('合成网络运维');
    expect(result.company).toBe('合成企业');
    expect(result.platform_job_id).toBe('current');
    expect(result.text).toContain('维护 Linux 服务器。\n要求网络基础与故障排查。');
    expect(result.text).not.toMatch(
      /不应读取|SyntheticRandom|AnotherRandom|color:|招聘者|详细地址/,
    );
  });
  it('prefers the dedicated title over its earlier title/salary container', () => {
    document.title = '合成职位列表';
    document.body.innerHTML = `<div class="job-list-box"><div class="job-card-wrapper active"><span class="job-name">合成系统运维</span><span class="company-name">合成公司</span><a href="/job_detail/current.html">职位详情</a></div></div><section class="job-detail-box"><div class="job-title"><span class="name">合成系统运维</span><span class="salary">8-12K</span></div><div class="company-name">合成公司</div><div class="job-sec-text">维护服务器和网络设备。</div></section>`;
    const result = observe(document, 'https://www.zhipin.com/web/geek/jobs')[0];
    expect(result.title).toBe('合成系统运维');
    expect(result.platform_job_id).toBe('current');
    expect(result.text).toContain('8-12K');
  });
  it('uses a title leaf supplied as the card root itself', () => {
    document.title = '合成职位列表';
    document.body.innerHTML =
      '<a class="job-card-wrapper job-name" href="/job_detail/current.html">合成系统运维</a>';
    const targets = listTargets(document, 'https://www.zhipin.com/web/geek/jobs');
    expect(targets).toHaveLength(1);
    expect(targets[0].title).toBe('合成系统运维');
    expect(targets[0].platform_job_id).toBe('current');
  });
  it('removes a separately marked salary from a legacy title container', () => {
    document.title = '合成职位列表';
    document.body.innerHTML = `<section class="job-detail-box"><div class="job-title">当前运维职位<span class="job-salary">8-12K</span></div><div class="job-sec-text">维护服务器和网络设备。</div></section>`;
    expect(observe(document, 'https://www.zhipin.com/web/geek/jobs')[0].title).toBe('当前运维职位');
  });
  it('allows related cards below an isolated detail without borrowing their title, company or ID', () => {
    document.title = '合成职位列表';
    document.body.innerHTML = `<aside class="job-list-box"><div class="job-card-wrapper"><span class="job-name">左侧其他职位</span><span class="company-name">左侧公司</span></div></aside><section class="job-detail-box"><h1 class="job-name">当前运维职位</h1><div class="job-sec-text">维护 Linux 系统，周末双休。</div><div class="related"><div class="job-card-wrapper"><a href="/job_detail/unrelated.html"><span class="job-name">推荐其他职位</span></a><span class="company-name">推荐其他公司</span></div></div></section>`;
    const result = observe(document, 'https://www.zhipin.com/web/geek/jobs')[0];
    expect(result.title).toBe('当前运维职位');
    expect(result.company).toBe('');
    expect(result.platform_job_id).toBe('');
    expect(result.text).not.toMatch(/左侧|推荐其他/);
  });
  it('does not assign an unrelated detail link to the current observation', () => {
    document.title = '合成职位列表';
    document.body.innerHTML = `<section class="job-detail-box"><h1 class="job-name">当前职位</h1><div class="job-sec-text">维护服务器和数据库。</div><a href="/job_detail/unrelated.html">其他职位</a></section>`;
    const result = observe(document, 'https://www.zhipin.com/web/geek/jobs')[0];
    expect(result.platform_job_id).toBe('');
    expect(result.url).toBe('https://www.zhipin.com/web/geek/jobs');
  });
  it('does not combine a left-list heading and an incomplete right description on a detail URL', () => {
    document.title = '合成职位';
    document.body.innerHTML = `<aside class="job-list-box"><h1>左侧职位列表标题</h1></aside><section class="job-detail-box"><div class="job-sec-text">右侧已经有描述，但没有当前职位标题。</div></section>`;
    expect(() => observe(document, 'https://www.zhipin.com/job_detail/current.html')).toThrow(
      '未找到',
    );
  });
  it('distinguishes unsupported stable markup from an actual loading indicator', () => {
    document.title = '合成职位列表';
    document.body.innerHTML =
      '<section class="job-detail-box"><div class="job-sec-text">已加载的描述，但没有支持的标题节点。</div></section>';
    expect(() => observe(document, 'https://www.zhipin.com/web/geek/jobs')).toThrow('布局暂未识别');
    document
      .querySelector('.job-detail-box')!
      .insertAdjacentHTML('beforeend', '<div role="progressbar">加载中</div>');
    expect(() => observe(document, 'https://www.zhipin.com/web/geek/jobs')).toThrow('尚未完整加载');
  });
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
      '布局暂未识别',
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

describe('observed Zhilian list-end marker', () => {
  it('accepts the visible direct final status even when its text is nested', () => {
    document.title = '合成智联职位';
    document.body.innerHTML = `<aside class="job-split-layout__left"><div class="job-list-panel"><div class="job-card">合成岗位</div><div class="job-list-panel__status job-list-panel__status--more"><div><span>没有更多了</span></div></div></div></aside>`;
    expect(listExhausted(document, 'https://www.zhaopin.com/jobs/')).toBe(true);
    expect(loadMoreTarget(document, 'https://www.zhaopin.com/jobs/')).toBeUndefined();
  });
  it.each(['加载中', '网络错误，请重试', '没有更多了，请刷新重试'])(
    'does not treat %s as an end result',
    (status) => {
      document.title = '合成智联职位';
      document.body.innerHTML = `<aside class="job-split-layout__left"><div class="job-list-panel"><div class="job-card">合成岗位</div><div class="job-list-panel__status job-list-panel__status--more">${status}</div></div></aside>`;
      expect(listExhausted(document, 'https://www.zhaopin.com/jobs/')).toBe(false);
      expect(loadMoreTarget(document, 'https://www.zhaopin.com/jobs/')).toBeDefined();
    },
  );
  it('ignores hidden, misplaced and unrelated end text', () => {
    document.title = '合成智联职位';
    document.body.innerHTML = `<aside class="job-split-layout__left"><div class="job-list-panel"><div class="job-card">合成岗位</div><div hidden class="job-list-panel__status job-list-panel__status--more">没有更多了</div></div><div class="job-list-panel__status job-list-panel__status--more">没有更多了</div></aside>`;
    expect(listExhausted(document, 'https://www.zhaopin.com/jobs/')).toBe(false);
    expect(loadMoreTarget(document, 'https://www.zhaopin.com/jobs/')).toBeDefined();
    expect(listExhausted(document, 'https://www.zhipin.com/web/geek/jobs')).toBe(false);
  });
});

describe('observed Zhilian standalone SSR detail', () => {
  const href = 'https://www.zhaopin.com/jobdetail/SYNTHETIC_JOB.htm?tracking=private';
  const fixture = () => {
    document.title = '合成智联独立职位';
    document.body.innerHTML = `<section class="summary-planes">
      <h1 class="summary-planes__title">合成网络运维</h1>
      <span class="summary-planes__salary">6000-8000元</span>
      <ul class="summary-planes__info"><li>郑州</li><li>金水区·合成街道</li><li>1-3年</li><li>大专</li></ul>
    </section><section class="describtion-card seo-card">
      <h2 class="seo-card__title">职位描述</h2><div class="seo-card__content">
        <div class="describtion-card__skills">Linux · TCP/IP</div>
        <div class="describtion-card__content-wrap">维护 Linux 服务器<br>周末双休</div>
      </div>
    </section><div class="company-info__header-left"><div class="company-info__meta">
      <a class="company-info__name" href="/companydetail/SYNTHETIC_CO.htm">合成网络公司</a>
    </div></div>`;
  };
  it('reads only the observed standalone summary, company and description blocks', () => {
    fixture();
    const result = observe(document, href);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: '合成网络运维',
      company: '合成网络公司',
      platform_job_id: 'SYNTHETIC_JOB',
      url: 'https://www.zhaopin.com/jobdetail/SYNTHETIC_JOB.htm',
      city: '郑州',
      page_kind: 'detail',
    });
    expect(result[0].text).toContain('6000-8000元');
    expect(result[0].text).toContain('郑州 · 金水区·合成街道 · 1-3年 · 大专');
    expect(result[0].text).toContain('Linux · TCP/IP');
    expect(result[0].text).toContain('维护 Linux 服务器\n周末双休');
  });
  it('ignores hidden previous roots, recommendations, company introduction and HR content', () => {
    fixture();
    const hidden = document.createElement('section');
    hidden.hidden = true;
    hidden.innerHTML = document.body.innerHTML.replaceAll('合成', '隐藏');
    document.body.append(hidden);
    document.body.insertAdjacentHTML(
      'afterbegin',
      `<h3 class="jobs-deliver__title">推荐职位不能作为当前标题</h3>
       <div class="seo-card"><h2 class="seo-card__title">公司介绍</h2><div class="seo-card__content">公司介绍不应收集</div></div>
       <div class="recruiter-info">HR个人姓名不应收集</div>
       <a href="/jobdetail/RECOMMEND.htm">相似职位不能作为当前ID</a>`,
    );
    document
      .querySelector('.describtion-card__content-wrap')!
      .insertAdjacentHTML(
        'beforeend',
        '<span hidden>隐藏正文不应收集</span><style>.private { color:red }</style><script>privateData()</script>',
      );
    const result = observe(document, href)[0];
    expect(result.title).toBe('合成网络运维');
    expect(result.platform_job_id).toBe('SYNTHETIC_JOB');
    expect(JSON.stringify(result)).not.toMatch(
      /隐藏|推荐职位|公司介绍|HR个人|相似职位|privateData|color/,
    );
  });
  it.each([
    '.summary-planes',
    'h1.summary-planes__title',
    '.describtion-card.seo-card',
    'a.company-info__name',
    '.describtion-card__content-wrap',
  ])('rejects competing visible current roots for %s', (selector) => {
    fixture();
    const original = document.querySelector(selector)!;
    original.parentElement!.append(original.cloneNode(true));
    expect(() => observe(document, href)).toThrow('未找到可验证');
  });
  it.each(['h1.summary-planes__title', '.describtion-card__content-wrap', 'a.company-info__name'])(
    'does not borrow a missing %s from recommendations or other page text',
    (selector) => {
      fixture();
      document.querySelector(selector)!.remove();
      document.body.insertAdjacentHTML(
        'beforeend',
        '<h3 class="jobs-deliver__title">推荐标题</h3><div class="seo-card__content">其他正文</div><a href="/companydetail/OTHER.htm">其他公司</a>',
      );
      expect(() => observe(document, href)).toThrow('未找到可验证');
    },
  );
  it('requires a nonempty actual description and its exact section heading', () => {
    fixture();
    document.querySelector('.describtion-card__content-wrap')!.textContent = '   ';
    expect(() => observe(document, href)).toThrow('未找到可验证');
    fixture();
    document.querySelector('h2.seo-card__title')!.textContent = '公司介绍';
    expect(() => observe(document, href)).toThrow('未找到可验证');
  });
  it.each([
    'https://www.zhaopin.com.evil.example/companydetail/SYNTHETIC.htm',
    'https://evil.example/companydetail/SYNTHETIC.htm',
    'http://www.zhaopin.com/companydetail/SYNTHETIC.htm',
    'https://user:secret@www.zhaopin.com/companydetail/SYNTHETIC.htm',
    'https://www.zhaopin.com:444/companydetail/SYNTHETIC.htm',
    '/jobdetail/SYNTHETIC.htm',
    'javascript:void(0)',
  ])('rejects an unverified company link %s', (companyHref) => {
    fixture();
    document.querySelector('a.company-info__name')!.setAttribute('href', companyHref);
    expect(() => observe(document, href)).toThrow('未找到可验证');
  });
  it('requires the observed company header ancestry', () => {
    fixture();
    document.querySelector('.company-info__meta')!.className = 'recommendation';
    expect(() => observe(document, href)).toThrow('未找到可验证');
  });
  it.each([
    'https://www.zhaopin.com/jobs/?pageMode=recommend',
    'https://www.zhaopin.com/recommend',
    'https://www.zhaopin.com/jobdetail/',
    'https://www.zhaopin.com/jobdetail/SYNTHETIC_JOB/other',
  ])('never enables SSR extraction on an unrelated route %s', (otherHref) => {
    fixture();
    expect(() => observe(document, otherHref)).toThrow();
  });
  it.each([
    'job-list-panel',
    'job-split-layout__left',
    'job-split-layout__right',
    'job-detail-modules',
  ])('does not combine SSR roots with a visible split/list region %s', (className) => {
    fixture();
    document.body.insertAdjacentHTML('beforeend', `<div class="${className}"></div>`);
    expect(() => observe(document, href)).toThrow('未找到可验证');
  });
  it('preserves redaction, salary-font warnings and existing field limits', () => {
    fixture();
    document.querySelector('.summary-planes__salary')!.textContent = '\uE123';
    document.querySelector('.describtion-card__content-wrap')!.textContent =
      '联系 13800000000 synthetic@example.test 110101199001010011 ' + '合成职责'.repeat(6000);
    const result = observe(document, href)[0];
    expect(result.text).toContain('薪资采用特殊字体，待核对');
    expect(result.text).toContain('[手机号已省略]');
    expect(result.text).toContain('[邮箱已省略]');
    expect(result.text).toContain('[身份证号已省略]');
    expect(result.text).not.toMatch(/13800000000|synthetic@example|110101199001010011|\uE123/);
    expect(result.text).toHaveLength(20000);
  });
});

describe('structure-only page diagnostics', () => {
  it('reports two bounded wrapper levels around list-tail cards without revealing their text', () => {
    document.body.innerHTML =
      '<div class="job-list-container"><ul class="rec-job-list"><div class="card-area is-seen"><div class="job-card-wrap"><li class="job-card-box">合成秘密岗位 联系人13800000000</li></div></div></ul></div>';
    const result = diagnosePage(document, 'https://www.zhipin.com/web/geek/jobs');
    const list = result.listSurroundings.find((item) => item.className === 'rec-job-list')!;
    expect(list.tail[0].className).toBe('card-area is-seen');
    expect(list.tail[0].children[0].className).toBe('job-card-wrap');
    expect(list.tail[0].children[0].children[0].tag).toBe('li');
    expect(list.tail[0].children[0].children[0].className).toBe('job-card-box');
    expect(JSON.stringify(result)).not.toMatch(/合成秘密岗位|13800000000/);
  });
  it('reports selector coverage and heading structure without content or URL query values', () => {
    document.title = '合成职位';
    document.body.innerHTML = `<section class="job-detail-box"><h1 class="job-name">合成秘密职位</h1><div class="job-section"><h3>职位描述</h3><div class="job-sec-text">联系人：合成姓名 13800000000，email@example.test</div></div><a href="/job_detail/private.html?tracking=secret">查看更多信息</a></section>`;
    const result = diagnosePage(
      document,
      'https://www.zhipin.com/web/geek/jobs?query=不应返回的检索词',
    );
    expect(result.pagePath).toBe('/web/geek/jobs');
    expect(result.selectors['.job-sec-text']).toEqual({ total: 1, visible: 1 });
    expect(result.descriptionHeadings[0].parent.className).toBe('job-section');
    expect(result.titleNodes[0].tag).toBe('h1');
    expect(JSON.stringify(result)).not.toMatch(
      /合成秘密职位|合成姓名|13800000000|email@example|tracking|secret|不应返回|查看更多信息/,
    );
  });
  it('does not inspect personal or unrelated pages', () => {
    expect(() => diagnosePage(document, 'https://www.zhipin.com/web/geek/chat')).toThrow();
    expect(() => diagnosePage(document, 'https://evil.example/web/geek/jobs')).toThrow();
  });
});
