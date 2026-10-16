import { useEffect, useRef, useState } from 'react';
import { request } from './api';

export type ConnectionState = {
  id: string;
  label: string;
  state: 'connected' | 'idle';
  last_seen_at?: string | null;
};

const isVisible = () => document.visibilityState !== 'hidden';

const signature = (rows: ConnectionState[]) =>
  rows
    .map((row) => `${row.id}:${row.state}`)
    .sort()
    .join('|');

/** Observe only while this screen is visible. Two samples confirm a transition. */
export function useConnectionStatus(enabled: boolean) {
  const [connections, setConnections] = useState<ConnectionState[]>([]);
  const [ready, setReady] = useState(false);
  const [serviceOffline, setServiceOffline] = useState(false);
  const [notice, setNotice] = useState('');
  const stable = useRef<ConnectionState[] | null>(null);
  const candidate = useRef<{ signature: string; samples: number } | null>(null);
  const failures = useRef(0);
  const offline = useRef(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef<(immediate?: boolean) => Promise<void>>(async () => {});

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let pending: AbortController | null = null;
    let fetchTimeout: ReturnType<typeof setTimeout> | null = null;
    function announce(message: string) {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      setNotice(message);
      noticeTimer.current = setTimeout(() => setNotice(''), 6000);
    }
    async function poll(immediate = false) {
      if (disposed || !isVisible() || pending) return;
      const controller = new AbortController();
      pending = controller;
      fetchTimeout = setTimeout(() => controller.abort(), 4000);
      try {
        const result = await request<{ connections: ConnectionState[] }>('/connections/status', {
          signal: controller.signal,
        });
        if (disposed || !isVisible()) return;
        failures.current = 0;
        if (offline.current) {
          offline.current = false;
          setServiceOffline(false);
          announce('工作台连接已恢复');
        }
        const rows = result.connections;
        if (stable.current === null) {
          stable.current = rows;
          setConnections(rows);
          setReady(true);
          return;
        }
        const next = signature(rows);
        if (next === signature(stable.current)) {
          candidate.current = null;
          return;
        }
        candidate.current =
          candidate.current?.signature === next
            ? { signature: next, samples: candidate.current.samples + 1 }
            : { signature: next, samples: 1 };
        if (!immediate && candidate.current.samples < 2) return;
        const before = new Map(stable.current.map((row) => [row.id, row.state]));
        const connected = rows.filter(
          (row) => row.state === 'connected' && before.get(row.id) !== 'connected',
        );
        const disconnected = stable.current.filter(
          (row) => !rows.some((nextRow) => nextRow.id === row.id),
        );
        const idle = rows.filter(
          (row) => row.state === 'idle' && before.get(row.id) === 'connected',
        );
        stable.current = rows;
        candidate.current = null;
        setConnections(rows);
        if (connected.length || disconnected.length || idle.length)
          announce(
            [
              connected.length ? `${connected.length} 个扩展已连接` : '',
              disconnected.length ? `${disconnected.length} 个扩展已断开` : '',
              idle.length ? '暂未检测到扩展活动' : '',
            ]
              .filter(Boolean)
              .join('，'),
          );
      } catch {
        if (disposed || !isVisible()) return;
        candidate.current = null;
        failures.current++;
        if (failures.current >= 2 && !offline.current) {
          offline.current = true;
          setServiceOffline(true);
          announce('暂时无法连接工作台，请确认程序仍在运行');
        }
      } finally {
        if (fetchTimeout) clearTimeout(fetchTimeout);
        pending = null;
      }
    }
    refreshRef.current = poll;
    function visibility() {
      if (!isVisible()) pending?.abort();
      else void poll();
    }
    document.addEventListener('visibilitychange', visibility);
    const timer = setInterval(() => void poll(), 5000);
    void poll();
    return () => {
      disposed = true;
      clearInterval(timer);
      if (fetchTimeout) clearTimeout(fetchTimeout);
      pending?.abort();
      document.removeEventListener('visibilitychange', visibility);
      refreshRef.current = async () => {};
    };
  }, [enabled]);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );
  return {
    connections,
    ready,
    serviceOffline,
    notice,
    refresh: (immediate = false) => refreshRef.current(immediate),
  };
}
