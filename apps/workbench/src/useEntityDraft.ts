import { useEffect, useRef, useState } from 'react';
import { post, request } from './api';

/** A complete form draft, isolated by entity. A conflict never replaces local edits. */
export function useEntityDraft(
  kind: 'profile' | 'strategy',
  key: string,
  initial: any,
  initialVersion?: number,
) {
  const [value, setValue] = useState<any>(initial);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [baseVersion, setBaseVersion] = useState(initialVersion);
  const entries = useRef(
    new Map<
      string,
      { data: any; version: number; baseVersion?: number; dirty: boolean; error: boolean }
    >(),
  );
  const active = useRef(key);
  const loaded = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef(Promise.resolve());
  active.current = key;

  function persist(entity: string) {
    queue.current = queue.current.then(async () => {
      const entry = entries.current.get(entity);
      if (!entry?.dirty || entry.error) return;
      const snapshot = entry.data;
      try {
        const saved = await post(`/scratch`, {
          kind,
          entity_id: entity,
          payload: snapshot,
          expected_version: entry.version,
          base_version: entry.baseVersion,
        });
        entry.version = saved.version;
        entry.dirty = entry.data !== snapshot;
        if (active.current === entity) setMessage(entry.dirty ? '正在保存草稿…' : '草稿已保存');
        if (entry.dirty) persist(entity);
      } catch (error) {
        entry.error = true;
        if (active.current === entity)
          setMessage(
            `草稿未保存：${error instanceof Error ? error.message : '请重试'}。当前修改仍保留在页面中。`,
          );
      }
    });
  }

  useEffect(() => {
    let disposed = false;
    const existing = entries.current.get(key);
    setReady(false);
    if (existing) {
      loaded.current = key;
      setValue(existing.data);
      setBaseVersion(existing.baseVersion);
      setMessage(existing.error ? '草稿未保存，当前修改仍保留在页面中' : '已恢复编辑草稿');
      setReady(true);
    } else {
      void request(`/scratch/${kind}?entity_id=${encodeURIComponent(key)}`)
        .then((saved: any) => {
          if (disposed) return;
          const data = saved.payload ?? initial;
          entries.current.set(key, {
            data,
            version: saved.version ?? 0,
            baseVersion: saved.base_version ?? initialVersion,
            dirty: false,
            error: false,
          });
          if (!disposed) {
            loaded.current = key;
            setValue(data);
            setBaseVersion(saved.base_version ?? initialVersion);
            setMessage(saved.payload ? '已恢复编辑草稿' : '');
            setReady(true);
          }
        })
        .catch((error: Error) => {
          if (!disposed)
            setMessage(`无法读取草稿：${error.message}。请恢复连接后刷新，避免覆盖已有草稿。`);
        });
    }
    return () => {
      disposed = true;
      if (timer.current) clearTimeout(timer.current);
      persist(key);
    };
  }, [kind, key]);

  useEffect(() => {
    function guard(event: BeforeUnloadEvent) {
      if ([...entries.current.values()].some((entry) => entry.dirty)) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  function update(next: any) {
    const entry = entries.current.get(key);
    if (!entry || !ready) return;
    entry.data = typeof next === 'function' ? next(entry.data) : next;
    entry.dirty = true;
    setValue(entry.data);
    setMessage('正在保存草稿…');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => persist(key), 400);
  }
  function retry() {
    const entry = entries.current.get(key);
    if (!entry) {
      window.location.reload();
      return;
    }
    // Preserve the conflicting form for explicit recovery, never overwrite a newer tab.
    void request(`/scratch/${kind}?entity_id=${encodeURIComponent(key)}`)
      .then((saved: any) => {
        if (
          saved.version !== entry.version &&
          !window.confirm('另一页面已更新这个草稿。使用当前页面的内容替换它？')
        )
          return;
        entry.version = saved.version ?? 0;
        entry.error = false;
        persist(key);
      })
      .catch((error: Error) => setMessage(error.message));
  }
  async function flush() {
    if (timer.current) clearTimeout(timer.current);
    for (const entity of entries.current.keys()) persist(entity);
    let pending: Promise<void>;
    do {
      pending = queue.current;
      await pending;
    } while (queue.current !== pending);
    if ([...entries.current.values()].some((entry) => entry.dirty))
      throw new Error('仍有草稿未保存，请先重试保存草稿。');
  }
  async function reset(entity: string, data: any, version?: number, discard = false) {
    if (discard) {
      const entry = entries.current.get(entity);
      if (entry) {
        entry.dirty = false;
        entry.error = false;
      }
    }
    await flush();
    const saved = await request(`/scratch/${kind}?entity_id=${encodeURIComponent(entity)}`);
    const result = await post('/scratch', {
      kind,
      entity_id: entity,
      payload: data,
      expected_version: saved.version ?? 0,
      base_version: version,
    });
    entries.current.set(entity, {
      data,
      version: result.version,
      baseVersion: version,
      dirty: false,
      error: false,
    });
    if (active.current === entity) {
      setValue(data);
      setBaseVersion(version);
      setMessage('草稿已保存');
    }
  }
  function forgetLinked(ids: Set<string>) {
    for (const [entity, entry] of entries.current) {
      if (ids.has(entity) || ids.has(entry.data.parent_id) || ids.has(entry.data.profile_id))
        entries.current.delete(entity);
    }
  }
  return {
    value,
    update,
    ready: ready && loaded.current === key,
    message,
    retry,
    flush,
    reset,
    forgetLinked,
    baseVersion,
  };
}
