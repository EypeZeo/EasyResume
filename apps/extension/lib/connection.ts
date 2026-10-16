import { localServer } from './observe';

export type Connection = { base: string; token: string; installation: string };
export type ConnectionState = 'unpaired' | 'connected' | 'offline' | 'expired' | 'incompatible';
export type PairingInfo = { base: string; code: string; protocol: 1; expires_at: string };

export function pairingInfo(input: string, now = Date.now()): PairingInfo {
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch {
    throw new Error('请粘贴工作台复制的完整连接信息');
  }
  if (!data || typeof data !== 'object') throw new Error('连接信息格式不正确');
  const info = data as Partial<PairingInfo>;
  if (
    info.protocol !== 1 ||
    typeof info.base !== 'string' ||
    typeof info.code !== 'string' ||
    !info.code.trim() ||
    info.code.length > 512 ||
    typeof info.expires_at !== 'string'
  )
    throw new Error('连接信息不完整或版本不兼容，请重新生成');
  const expiry = Date.parse(info.expires_at);
  if (!Number.isFinite(expiry) || expiry <= now)
    throw new Error('连接信息已过期，请在工作台重新生成');
  return {
    base: localServer(info.base),
    code: info.code.trim(),
    protocol: 1,
    expires_at: info.expires_at,
  };
}

export async function connectionState(
  connection?: Connection,
  request: typeof fetch = fetch,
): Promise<ConnectionState> {
  if (!connection) return 'unpaired';
  let base: string;
  try {
    base = localServer(connection.base);
  } catch {
    return 'incompatible';
  }
  try {
    const response = await request(`${base}/api/v1/connection`, {
      headers: { Authorization: `Bearer ${connection.token}` },
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (response.status === 401 || response.status === 403) return 'expired';
    if (response.status === 404 || response.status === 426) return 'incompatible';
    if (!response.ok) return 'offline';
    const body = await response.json();
    return body.protocol === 1 && body.installation_id === connection.installation
      ? 'connected'
      : 'incompatible';
  } catch {
    return 'offline';
  }
}
