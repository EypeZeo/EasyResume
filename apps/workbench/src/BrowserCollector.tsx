import { useEffect, useRef, useState } from 'react';

export default function BrowserCollector({ onSaved }: { onSaved: () => Promise<unknown> }) {
  const [platform, setPlatform] = useState('boss');
  const [message, setMessage] = useState('保持招聘网站已登录，可在这里定位并读取岗位。');
  const [busy, setBusy] = useState(false);
  const [observations, setObservations] = useState<any[]>([]);
  const [choices, setChoices] = useState<any[]>([]);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [batch, setBatch] = useState<any>(null);
  const [maxJobs, setMaxJobs] = useState(20);
  const [autoPage, setAutoPage] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedTab, setSelectedTab] = useState<number>();
  const retry = useRef<{ type: string; payload: object } | undefined>(undefined);
  const pending = useRef(
    new Map<
      string,
      {
        resolve: (v: any) => void;
        reject: (e: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const call = pending.current.get(detail?.request_id);
      if (!call) return;
      pending.current.delete(detail.request_id);
      clearTimeout(call.timer);
      call.resolve(detail.result ?? {});
    };
    window.addEventListener('easyresume:browser-result', receive);
    return () => {
      window.removeEventListener('easyresume:browser-result', receive);
      for (const call of pending.current.values()) {
        clearTimeout(call.timer);
        call.reject(new Error('页面已关闭'));
      }
      pending.current.clear();
    };
  }, []);
  function send(type: string, payload: object = {}, timeout = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      const request_id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.current.delete(request_id);
        reject(
          new Error('扩展未响应。请重新加载本地扩展并刷新工作台，确认它与工作台在同一个浏览器中。'),
        );
      }, timeout);
      pending.current.set(request_id, { resolve, reject, timer });
      window.dispatchEvent(
        new CustomEvent('easyresume:browser-command', { detail: { request_id, type, ...payload } }),
      );
    });
  }
  useEffect(() => {
    let disposed = false;
    void send('BATCH_STATUS')
      .then((result) => {
        if (!disposed && result.status) {
          setBatch((previous: any) => previous ?? result);
          if (result.status === 'recovering')
            setMessage(result.message || '正在刷新招聘页面并恢复批量读取…');
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);
  async function run(type: string, payload: object = {}) {
    setBusy(true);
    if (type === 'READ' || type === 'LOCATE_JOB_PAGE') {
      setObservations([]);
      setDiagnostics(null);
    }
    try {
      const navigates = ['READ', 'LOCATE_JOB_PAGE', 'BATCH_START'].includes(type);
      const result = await send(
        type,
        navigates
          ? {
              platform,
              ...(type === 'LOCATE_JOB_PAGE' || selectedTab === undefined
                ? {}
                : { tabId: selectedTab }),
              ...payload,
            }
          : payload,
      );
      if (result.diagnostics) setDiagnostics(result.diagnostics);
      if (result.error && result.code !== 'NEEDS_SELECTION') throw new Error(result.error);
      if (result.choices?.length) {
        retry.current = { type, payload };
        setChoices(result.choices);
        setMessage('找到多个招聘页面，请选择要读取的页面。');
        return;
      }
      setChoices([]);
      if (result.tabId !== undefined) setSelectedTab(result.tabId);
      if (result.observations) {
        setObservations(result.observations);
        setMessage(`已读到 ${result.observations.length} 个职位，请核对后保存。`);
      } else if (type === 'SAVE') {
        setObservations([]);
        setMessage(
          `新增 ${result.saved ?? 0} 个职位，跳过重复 ${result.duplicates ?? 0} 个${result.pendingReview ? `，${result.pendingReview} 个职位有变化待核对` : ''}${result.unconfirmed ? `，${result.unconfirmed} 个保存结果待核对` : ''}。返回岗位工作台继续筛选。`,
        );
        void onSaved().catch(() => {});
      } else if (result.status) {
        setBatch(result);
        setMessage(
          result.message ||
            (result.status === 'recovering'
              ? '正在刷新招聘页面并恢复批量读取…'
              : '批量任务状态已更新'),
        );
      } else setMessage(result.message || '已定位招聘页面，可以继续读取。');
    } catch (error) {
      if (['READ', 'LOCATE_JOB_PAGE', 'BATCH_START'].includes(type)) {
        setSelectedTab(undefined);
        setChoices([]);
      }
      setMessage(error instanceof Error ? error.message : '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!['running', 'recovering'].includes(batch?.status)) return;
    let disposed = false,
      checking = false;
    const timer = setInterval(() => {
      if (checking) return;
      checking = true;
      void send('BATCH_STATUS', {}, 6000)
        .then((result) => {
          if (result.error) throw new Error(result.error);
          if (!disposed) {
            setBatch(result);
            if (result.message) setMessage(result.message);
            if (!['running', 'recovering'].includes(result.status)) void onSaved().catch(() => {});
          }
        })
        .catch((error) => {
          if (!disposed) setMessage(error.message);
        })
        .finally(() => {
          checking = false;
        });
    }, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [batch?.status]);
  const running = ['running', 'recovering'].includes(batch?.status);
  const paused = batch?.status === 'paused';
  const batchPlatform =
    batch?.scope?.platform === 'boss'
      ? 'BOSS直聘'
      : batch?.scope?.platform === 'zhilian'
        ? '智联招聘'
        : '来源未记录';
  return (
    <section className="panel" aria-labelledby="browser-collect-title">
      <h3 id="browser-collect-title">从浏览器整理岗位</h3>
      <p className="helper">
        打开本机工作台后自动连接。选择网站，再定位到实际职位页；不会在首页、聊天页继续读取。
      </p>
      <label className="field">
        招聘网站
        <select
          value={platform}
          disabled={busy || running || paused}
          onChange={(e) => {
            setPlatform(e.target.value);
            setObservations([]);
            setChoices([]);
            setSelectedTab(undefined);
            setDiagnostics(null);
            retry.current = undefined;
            setMessage('已切换招聘网站，请定位或读取该网站的职位。');
          }}
        >
          <option value="boss">BOSS直聘</option>
          <option value="zhilian">智联招聘</option>
        </select>
      </label>
      <div className="action-row">
        <a
          className="button secondary"
          href={
            platform === 'boss'
              ? 'https://www.zhipin.com/web/geek/jobs'
              : 'https://www.zhaopin.com/recommend'
          }
          target="_blank"
          rel="noopener noreferrer"
        >
          打开职位网站 ↗
        </a>
        <button
          className="button secondary"
          disabled={busy || running || paused}
          onClick={() => void run('LOCATE_JOB_PAGE', { purpose: 'current' })}
        >
          定位招聘页面
        </button>
        <button
          className="button primary"
          disabled={busy || running || paused}
          onClick={() => void run('READ')}
        >
          读取浏览器当前职位
        </button>
        {observations.length > 0 && (
          <button
            className="button primary"
            disabled={busy || running || paused}
            onClick={() => void run('SAVE', { observations })}
          >
            保存读取的职位
          </button>
        )}
      </div>
      {choices.length > 0 && (
        <ul>
          {choices.map((choice) => (
            <li key={choice.tabId ?? choice.entryUrl}>
              <button
                className="text-button"
                disabled={busy || running || paused}
                onClick={() => {
                  if (choice.tabId === undefined) {
                    setMessage('请在招聘网站中点击此职位入口，再重试。');
                    return;
                  }
                  setSelectedTab(choice.tabId);
                  void run(retry.current?.type ?? 'LOCATE_JOB_PAGE', {
                    ...retry.current?.payload,
                    tabId: choice.tabId,
                  });
                }}
              >
                {choice.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      {observations.length > 0 && (
        <ul>
          {observations.map((item, index) => (
            <li key={index}>
              <strong>{item.title}</strong> · {item.company || '公司待核对'}
              {item.text?.includes('薪资采用特殊字体') && ' · 薪资待核对'}
              {item.text && (
                <details className="record-source">
                  <summary>查看读取的职位内容</summary>
                  <pre className="source-text">{item.text}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary>批量读取</summary>
        <button className="text-button" disabled={busy} onClick={() => void run('BATCH_STATUS')}>
          检查批量任务
        </button>
        <label className="field">
          最多读取
          <input
            type="number"
            min={1}
            max={100}
            value={maxJobs}
            disabled={busy || running || paused}
            onChange={(e) => setMaxJobs(Number(e.target.value))}
          />
        </label>
        <label className="check-line">
          <input
            type="checkbox"
            checked={autoPage}
            disabled={busy || running || paused}
            onChange={(e) => setAutoPage(e.target.checked)}
          />
          自动翻页或加载下一批（最多2页）
        </label>
        <label className="check-line">
          <input
            type="checkbox"
            checked={autoRefresh}
            disabled={busy || running || paused}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          加载失败时自动刷新一次并恢复
        </label>
        <p className="helper">
          缺少职位编号时从首条重新核对，相同记录去重；重复核对也计入本次上限。
          每任务最多刷新一次，验证码或返回首页仍会暂停。
        </p>
        <div className="action-row">
          {!running && !paused && (
            <button
              className="button primary"
              disabled={busy || !Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 100}
              onClick={() =>
                void run('BATCH_START', {
                  maxJobs,
                  maxPages: autoPage ? 2 : 1,
                  autoPage,
                  autoRefresh,
                })
              }
            >
              开始浏览器批量读取
            </button>
          )}
          {running && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void run('BATCH_PAUSE')}
            >
              暂停批量读取
            </button>
          )}
          {paused && (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void run('BATCH_RESUME')}
            >
              继续批量读取
            </button>
          )}
          {(running || paused) && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void run('BATCH_STOP')}
            >
              停止批量读取
            </button>
          )}
        </div>
        {batch && batch.status !== 'idle' && (
          <p
            data-batch-platform={
              batch?.scope?.platform === 'boss' || batch?.scope?.platform === 'zhilian'
                ? batch.scope.platform
                : 'unknown'
            }
          >
            <strong>{batchPlatform} · 批量结果</strong>
            {' · '}
            已检查 {batch.visited ?? 0} 条 · 新增 {batch.saved ?? 0} 条 · 第 {batch.pages ?? 0} 页
            {` · 已尝试刷新 ${batch.refreshes ?? 0} 次`}
            {batch.pendingReview > 0 && ` · ${batch.pendingReview} 条变化待核对`}
            {batch.unconfirmed > 0 && ` · ${batch.unconfirmed} 条保存结果待核对`}
          </p>
        )}
      </details>
      <p role="status" aria-live="polite">
        {busy ? '正在等待浏览器返回…' : message}
      </p>
      {diagnostics && (
        <details>
          <summary>读取诊断（排查时使用）</summary>
          <pre
            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
            data-browser-diagnostics
          >
            {JSON.stringify(diagnostics, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}
