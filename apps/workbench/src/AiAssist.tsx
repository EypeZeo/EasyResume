import { useEffect, useRef, useState } from 'react';
import { HttpError, post, put, request } from './api';

export function AiSettings() {
  const [config, setConfig] = useState<any>(null);
  const [key, setKey] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void request('/ai/config')
      .then(setConfig)
      .catch((e: Error) => setMessage(e.message));
  }, []);
  if (!config) return <p role="status">{message || '正在读取 AI 设置…'}</p>;
  return (
    <section className="panel ai-settings">
      <h2>AI 辅助识别</h2>
      <p>可选。未开启时仍可导入、检查和保存简历。</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSaving(true);
          setMessage('');
          void put('/ai/config', {
            enabled: config.enabled,
            base_url: config.base_url,
            model: config.model,
            ...(key ? { api_key: key } : {}),
          })
            .then((saved) => {
              setConfig(saved);
              setKey('');
              setMessage('AI 设置已保存');
            })
            .catch((error: Error) => setMessage(error.message))
            .finally(() => setSaving(false));
        }}
      >
        <label className="check-line">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
          />
          启用 AI 辅助识别
        </label>
        <div className="form-grid">
          <label className="field">
            接口地址
            <input
              type="url"
              value={config.base_url}
              placeholder="https://api.deepseek.com/v1"
              required={config.enabled}
              onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
            />
          </label>
          <label className="field">
            模型
            <input
              value={config.model}
              placeholder="deepseek-chat"
              required={config.enabled}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
            />
          </label>
        </div>
        <label className="field">
          接口密钥
          <input
            type="password"
            autoComplete="new-password"
            value={key}
            placeholder={config.key_set ? '已设置；留空保留现有密钥' : '输入服务提供商的 API Key'}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <p className="helper">
          接口密钥仅在本次运行期间保存，重启后需重新填写。使用服务可能产生费用；每次发送前都会显示内容和目标服务。
        </p>
        <button className="button secondary" disabled={saving}>
          {saving ? '正在保存…' : '保存 AI 设置'}
        </button>
        <p role="status">{message}</p>
      </form>
    </section>
  );
}

export function AiAssist({
  text,
  onSuggestion,
  onSettings,
}: {
  text: string;
  onSuggestion: (profile: any) => void;
  onSettings: () => void;
}) {
  const [preview, setPreview] = useState<any>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const generation = useRef(0);
  const currentTask = useRef<string | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  function clearTimers() {
    if (timeout.current) clearTimeout(timeout.current);
    if (deadline.current) clearTimeout(deadline.current);
    timeout.current = null;
    deadline.current = null;
  }
  function stopWaiting(note: string, cancelTask = false) {
    generation.current++;
    clearTimers();
    const id = currentTask.current;
    currentTask.current = null;
    setTaskId(null);
    setSending(false);
    setPreview(null);
    setMessage(note);
    if (cancelTask && id)
      void request(`/ai/tasks/${id}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
  }
  useEffect(() => {
    setPreview(null);
    setSending(false);
    setTaskId(null);
    setMessage('');
    return () => {
      generation.current++;
      clearTimers();
      if (currentTask.current)
        void request(`/ai/tasks/${currentTask.current}`, { method: 'DELETE' }).catch(() => {});
      currentTask.current = null;
    };
  }, [text]);
  async function prepare() {
    setSending(true);
    setMessage('正在准备脱敏预览…');
    const epoch = ++generation.current;
    try {
      const result = await post('/ai/preview', { text });
      if (epoch === generation.current) {
        setPreview(result);
        setMessage('请检查并移除仍可能识别你的信息。');
      }
    } catch (error) {
      if (epoch === generation.current)
        setMessage(error instanceof Error ? error.message : '无法生成预览');
    } finally {
      if (epoch === generation.current) setSending(false);
    }
  }
  async function poll(id: string, epoch: number) {
    try {
      const result = await request(`/ai/tasks/${id}`);
      if (epoch !== generation.current) return;
      if (result.status === 'waiting') {
        timeout.current = setTimeout(() => void poll(id, epoch), 1000);
        return;
      }
      setSending(false);
      clearTimers();
      setTaskId(null);
      currentTask.current = null;
      if (result.status === 'completed') {
        onSuggestion(result.profile);
        setPreview(null);
        setMessage('AI 建议已返回，请逐项检查后采用。');
      } else {
        setPreview(null);
        setMessage(
          result.error ||
            (result.status === 'cancelled'
              ? '已取消。当前简历未改变。'
              : '识别失败，请重新预览后重试。'),
        );
      }
    } catch (error) {
      if (epoch !== generation.current) return;
      if (
        error instanceof HttpError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![408, 429].includes(error.status)
      ) {
        stopWaiting(
          error.status === 404
            ? 'AI 任务已过期，请重新预览并确认后重试。当前简历未改变。'
            : '无法继续读取 AI 任务，请检查设置后重新预览。当前简历未改变。',
        );
        return;
      }
      // Keep the task handle so the user can explicitly cancel after an interrupted poll.
      setMessage(
        `${error instanceof Error ? error.message : '暂时无法读取结果'}。可取消后重新预览。`,
      );
      timeout.current = setTimeout(() => void poll(id, epoch), 3000);
    }
  }
  async function submit() {
    if (!preview) return;
    setSending(true);
    setMessage('等待 AI 返回…');
    const epoch = ++generation.current;
    clearTimers();
    deadline.current = setTimeout(() => {
      if (epoch === generation.current)
        stopWaiting('等待已超过 90 秒，已停止读取结果。当前简历未改变，请重新预览后重试。', true);
    }, 90000);
    try {
      const task = await post('/ai/tasks', {
        preview_id: preview.preview_id,
        text: preview.text,
        confirmed: true,
      });
      if (epoch !== generation.current) {
        void request(`/ai/tasks/${task.id}`, {
          method: 'DELETE',
          signal: AbortSignal.timeout(5000),
        }).catch(() => {});
        return;
      }
      currentTask.current = task.id;
      setTaskId(task.id);
      void poll(task.id, epoch);
    } catch (error) {
      if (epoch === generation.current) {
        stopWaiting(error instanceof Error ? error.message : '请求失败，请重新预览后重试');
      }
    }
  }
  async function cancel() {
    const epoch = ++generation.current;
    clearTimers();
    const id = currentTask.current;
    try {
      if (id)
        await request(`/ai/tasks/${id}`, { method: 'DELETE', signal: AbortSignal.timeout(5000) });
      if (epoch === generation.current)
        setMessage('已取消等待。已发给服务的内容无法撤回，当前简历未改变。');
    } catch (error) {
      if (epoch === generation.current)
        setMessage(
          `取消请求未确认：${error instanceof Error ? error.message : '服务暂时不可用'}。不会采用返回结果。`,
        );
    } finally {
      if (epoch === generation.current) {
        currentTask.current = null;
        setTaskId(null);
        setSending(false);
        setPreview(null);
      }
    }
  }
  return (
    <div className="ai-assist">
      <div className="action-row">
        <button
          type="button"
          className="button secondary"
          disabled={sending || !text.trim()}
          onClick={() => void prepare()}
        >
          {message && !preview && !sending ? '重新预览并重试 AI' : 'AI 辅助识别'}
        </button>
        <button type="button" className="text-button" onClick={onSettings}>
          AI 设置
        </button>
      </div>
      {message && (
        <p role="status" className="helper">
          {message}
        </p>
      )}
      {preview && (
        <section className="suggestion-panel" aria-label="AI 发送预览">
          <h3>确认发送给 {preview.target}</h3>
          <p>
            模型：{preview.model}
            。只发送下面的文本，不上传原始文件。自动脱敏可能遗漏，请检查后继续。
          </p>
          <label className="field">
            脱敏文本（可以继续删除个人信息）
            <textarea
              rows={12}
              disabled={sending}
              value={preview.text}
              onChange={(e) => setPreview({ ...preview, text: e.target.value })}
            />
          </label>
          <div className="action-row">
            <button
              type="button"
              className="button primary"
              disabled={sending || !preview.text.trim()}
              onClick={() => void submit()}
            >
              {sending ? '等待 AI 返回…' : '确认发送脱敏文本'}
            </button>
            <button type="button" className="button secondary" onClick={() => void cancel()}>
              {taskId ? '取消等待' : '取消'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
