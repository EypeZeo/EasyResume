import { useEffect, useState } from 'react';
import { ArrowDownToLine, Upload } from 'lucide-react';
import { download, post, request } from './api';
import { AiSettings } from './AiAssist';

export default function SettingsPage({
  state,
  run,
  refresh,
  onBackup,
  startTab = 'extension',
  onObservation,
}: {
  state: any;
  run: (task: () => Promise<void>, success?: string) => Promise<void>;
  refresh: () => Promise<any>;
  onBackup: (backup: any, preview: any) => void;
  startTab?: string;
  onObservation: (observation: any) => void;
}) {
  const [tab, setTab] = useState(startTab);
  const [pair, setPair] = useState<any>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = pair
    ? Math.max(0, Math.ceil((new Date(pair.expires_at).getTime() - now) / 1000))
    : 0;
  const envelope = pair
    ? JSON.stringify({
        base: location.origin,
        code: pair.code,
        expires_at: pair.expires_at,
        protocol: 1,
      })
    : '';
  return (
    <>
      <section className="page-heading">
        <div>
          <h1>设置与连接</h1>
          <p>管理扩展、备份和可选服务。</p>
        </div>
      </section>
      <nav className="settings-tabs tabs" aria-label="设置分类">
        {Object.entries({ extension: '浏览器扩展', data: '数据管理', help: '关于与帮助' }).map(
          ([id, title]) => (
            <button
              key={id}
              className={tab === id ? 'selected' : ''}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              {title}
            </button>
          ),
        )}
      </nav>
      {tab === 'extension' && (
        <section className="panel settings-content">
          <h2>连接浏览器扩展</h2>
          <ol className="setup-steps">
            <li>
              从{' '}
              <a
                href="https://github.com/EypeZeo/EasyResume/releases"
                target="_blank"
                rel="noreferrer"
              >
                下载页
              </a>{' '}
              下载并安装扩展，安装方法见{' '}
              <a
                href="https://github.com/EypeZeo/EasyResume#readme"
                target="_blank"
                rel="noreferrer"
              >
                使用手册
              </a>
              。
            </li>
            <li>在下方生成连接信息，复制到扩展的连接输入框中。</li>
            <li>在浏览器打开 BOSS 职位页，点击扩展中的读取按钮，再回工作台检查岗位。</li>
          </ol>
          <p className="helper">扩展读取当前页面。自动发送尚未开放。</p>
          <div className="action-row">
            <button
              className="button primary"
              onClick={() =>
                void run(async () => {
                  setPair(await post('/pairing'));
                  setNow(Date.now());
                  setCopied(false);
                })
              }
            >
              {pair && !seconds ? '重新生成连接信息' : '生成连接信息'}
            </button>
            {pair && (
              <button
                className="button secondary"
                disabled={!seconds}
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(envelope);
                    setCopied(true);
                  })
                }
              >
                {copied ? '已复制连接信息' : '复制连接信息'}
              </button>
            )}
          </div>
          {pair && (
            <div className="pair-box">
              <p role="status">
                {seconds
                  ? `连接信息还可使用 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
                  : '连接信息已过期，请重新生成。'}
              </p>
              <details>
                <summary>手动填写连接信息</summary>
                <p className="helper">
                  下面的地址用于连接这台电脑上运行的 EasyResume，通常不需要修改。
                </p>
                <label className="field">
                  工作台地址
                  <input readOnly value={location.origin} onFocus={(e) => e.target.select()} />
                </label>
                <label className="field">
                  一次性连接代码
                  <input
                    readOnly
                    value={seconds ? pair.code : '已过期'}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
              </details>
            </div>
          )}
          <div className="panel-heading">
            <h3>已授权的扩展</h3>
            <button
              className="text-button"
              onClick={() =>
                void run(async () => {
                  await refresh();
                })
              }
            >
              刷新连接列表
            </button>
          </div>
          {!state.connections.length && <p className="muted">尚未连接扩展。</p>}
          {state.connections.map((connection: any) => (
            <div className="record-row" key={connection.id}>
              <div>
                <strong>{connection.label}</strong>
                <small>已授权；在线状态请在扩展中查看</small>
              </div>
              <button
                className="text-button danger"
                onClick={() =>
                  void run(async () => {
                    await request(`/connections/${connection.id}`, { method: 'DELETE' });
                    await refresh();
                  }, '已断开此扩展')
                }
              >
                断开连接
              </button>
            </div>
          ))}
        </section>
      )}
      {tab === 'data' && (
        <div className="settings-content">
          <section className="panel">
            <h2>数据备份与恢复</h2>
            <p>备份包含简历结构、策略、岗位和黑名单。恢复前可查看新增与跳过数量。</p>
            <details>
              <summary>哪些内容不在备份中？</summary>
              <p>
                简历原件、原文与证据片段、姓名、HR
                个人信息、聊天、接口密钥及连接凭据不会导出。恢复后部分字段需要重新检查，扩展需要重新连接。
              </p>
            </details>
            <div className="action-row backup-actions">
              <button
                className="button secondary"
                onClick={() =>
                  void run(async () => download(await request('/backup'), 'easyresume-backup.json'))
                }
              >
                <ArrowDownToLine size={16} />
                导出备份
              </button>
              <label className="button secondary file-button">
                <Upload size={16} />
                从备份恢复
                <input
                  type="file"
                  aria-label="从备份恢复"
                  accept=".json"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file)
                      void run(async () => {
                        if (file.size > 10 * 1024 * 1024) throw new Error('备份超过 10MB');
                        const data = JSON.parse(await file.text());
                        onBackup(data, await post('/restore/preview', data));
                      });
                  }}
                />
              </label>
            </div>
          </section>
          <section className="panel mt">
            <h2>职位 / 公司黑名单</h2>
            <p className="helper">从岗位详情添加；公司按完整名称匹配。</p>
            {!state.blacklist.length && <p className="muted">暂无黑名单。</p>}
            {state.blacklist.map((entry: any) => (
              <div className="record-row" key={entry.id}>
                <div>
                  <strong>{entry.data.target === 'company' ? entry.data.value : '指定职位'}</strong>
                  <small>{entry.data.reason}</small>
                </div>
                <button
                  className="text-button"
                  onClick={() =>
                    void run(async () => {
                      await request(`/blacklist/${entry.id}`, { method: 'DELETE' });
                      await refresh();
                    }, '已从黑名单恢复')
                  }
                >
                  恢复
                </button>
              </div>
            ))}
          </section>
        </div>
      )}
      {tab === 'help' && (
        <div className="settings-content">
          <section className="panel">
            <h2>使用帮助</h2>
            <p>
              <a
                href="https://github.com/EypeZeo/EasyResume#readme"
                target="_blank"
                rel="noreferrer"
              >
                打开使用手册
              </a>{' '}
              ·{' '}
              <a
                href="https://github.com/EypeZeo/EasyResume/issues"
                target="_blank"
                rel="noreferrer"
              >
                反馈问题
              </a>
            </p>
            <p>
              当前支持简历整理、岗位筛选和沟通草稿。BOSS
              页面读取为测试功能，实际联系和发送请在招聘平台完成。
            </p>
          </section>
          <AiSettings />
          <details className="panel mt">
            <summary>诊断与页面观察记录</summary>
            <p>{state.observations.length} 条页面观察。诊断记录不代表平台兼容性验收已完成。</p>
            <button
              className="button secondary"
              onClick={() =>
                download(
                  {
                    format: 'easyresume-observations',
                    status: 'unverified',
                    sending_verified: false,
                    observations: state.observations.map((record: any) => ({
                      ...record.data,
                      installation_id: undefined,
                      proposed_job: undefined,
                    })),
                  },
                  'easyresume-observations.json',
                )
              }
            >
              导出采样记录
            </button>
            {state.observations
              .filter((record: any) => record.data.proposed_job && record.data.job_id)
              .map((record: any) => (
                <div className="record-row" key={record.id}>
                  <div>
                    <strong>岗位信息有变化</strong>
                    <small>{record.data.proposed_job.title}</small>
                  </div>
                  <button className="button secondary" onClick={() => onObservation(record)}>
                    核对变更
                  </button>
                </div>
              ))}
          </details>
        </div>
      )}
    </>
  );
}
