import { localServer } from './observe';

export type Connection = { base: string; token: string; installation: string };
export type ConnectionState = 'unpaired' | 'connected' | 'offline' | 'expired' | 'incompatible';
export type PairingInfo = { base: string; code: string; protocol: 1; expires_at?: string };
export type ConnectionResult = { state: ConnectionState; connection?: Connection };

const encoder = new TextEncoder();
const hex = (data: ArrayBuffer | Uint8Array) =>
  Array.from(data instanceof Uint8Array ? data : new Uint8Array(data), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

async function provenServer(
  connection: Connection,
  base: string,
  request: typeof fetch,
): Promise<'active' | 'revoked' | undefined> {
  const challenge = hex(crypto.getRandomValues(new Uint8Array(32)));
  try {
    const response = await request(`${base}/api/v1/connection/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installation_id: connection.installation, challenge }),
      signal: AbortSignal.timeout(1500),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) return;
    const body = await response.json();
    if (
      body.name !== 'EasyResume' ||
      body.protocol !== 1 ||
      body.installation_id !== connection.installation ||
      body.challenge !== challenge ||
      body.origin !== base ||
      typeof body.instance !== 'string' ||
      !/^[a-f0-9]{32}$/.test(body.instance) ||
      !['active', 'revoked'].includes(body.status) ||
      typeof body.proof !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body.proof)
    )
      return;
    const tokenDigest = hex(
      await crypto.subtle.digest('SHA-256', encoder.encode(connection.token)),
    );
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(tokenDigest),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const signature = Uint8Array.from(body.proof.match(/../g)!, (part: string) =>
      parseInt(part, 16),
    );
    const message = `EasyResume:1:${connection.installation}:${challenge}:${body.instance}:${body.status}:${base}`;
    return (await crypto.subtle.verify('HMAC', key, signature, encoder.encode(message)))
      ? body.status
      : undefined;
  } catch {
    return;
  }
}

/** Reuse the original pairing across restarts and bounded local port changes. */
export async function reconnectConnection(
  connection?: Connection,
  candidateBases: string[] = [],
  request: typeof fetch = fetch,
): Promise<ConnectionResult> {
  if (!connection) return { state: 'unpaired' };
  let original: string;
  try {
    original = localServer(connection.base);
  } catch {
    return { state: 'incompatible', connection };
  }
  const attempt = async (base: string): Promise<ConnectionResult | undefined> => {
    const proof = await provenServer(connection, base, request);
    if (proof === 'revoked') return { state: 'expired', connection: { ...connection, base } };
    if (proof !== 'active') return;
    const updated = { ...connection, base };
    return { state: await connectionState(updated, request), connection: updated };
  };
  const current = await attempt(original);
  if (current) return current;
  // Never send tokens while discovering ports. An occupied port may be another app.
  const previousPort = Number(new URL(original).port || 80);
  const ports = [...new Set([previousPort, 8765])].flatMap((start) =>
    Array.from(
      { length: Math.min(30, 65536 - start) },
      (_, index) => `http://127.0.0.1:${start + index}`,
    ),
  );
  const candidates = new Set<string>();
  for (const candidate of [...candidateBases.slice(0, 10), ...ports]) {
    try {
      const base = localServer(candidate);
      if (base !== original) candidates.add(base);
    } catch {
      // Ignore untrusted address hints rather than contacting them.
    }
  }
  const queue = [...candidates];
  for (let offset = 0; offset < queue.length; offset += 6) {
    const results = await Promise.all(queue.slice(offset, offset + 6).map(attempt));
    const found =
      results.find((result) => result?.state === 'connected') ??
      results.find((result) => result?.state === 'expired') ??
      results.find((result) => result !== undefined);
    if (found) return found;
  }
  return { state: 'offline', connection };
}

export function pairingInfo(input: string, now = Date.now()): PairingInfo {
  const compact = input.trim().replace(/[\s-]/g, '');
  if (/^\d{25}$/.test(compact)) {
    const port = Number(compact.slice(0, 5));
    if (port < 1 || port > 65535) throw new Error('连接码中的地址无效，请在工作台重新生成');
    return {
      base: localServer(`http://127.0.0.1:${port}`),
      code: compact.slice(5),
      protocol: 1,
    };
  }
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch {
    throw new Error('请粘贴工作台复制的完整连接码（5 组数字）');
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

/** Local removal is always possible; an offline server cannot confirm revocation. */
export async function revokeConnection(
  connection?: Connection,
  request: typeof fetch = fetch,
): Promise<boolean> {
  if (!connection) return true;
  try {
    const base = localServer(connection.base);
    const proof = await provenServer(connection, base, request);
    if (proof === 'revoked') return true;
    if (proof !== 'active') return false;
    const response = await request(`${base}/api/v1/connection`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${connection.token}` },
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
      cache: 'no-store',
    });
    return response.ok || response.status === 401 || response.status === 403;
  } catch {
    return false;
  }
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
