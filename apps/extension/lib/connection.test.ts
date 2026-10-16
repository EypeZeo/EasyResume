import { describe, expect, it, vi } from 'vitest';
import { connectionState, pairingInfo } from './connection';

const connection = {
  base: 'http://127.0.0.1:8765',
  token: 'synthetic-token',
  installation: 'synthetic-install',
};
const info = {
  base: connection.base,
  code: 'synthetic-code',
  expires_at: '2030-01-01T00:05:00Z',
  protocol: 1,
};
const now = Date.parse('2030-01-01T00:00:00Z');
const respond = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('pairing information', () => {
  it('accepts current loopback information without exposing a long-lived credential', () => {
    expect(pairingInfo(JSON.stringify(info), now)).toEqual(info);
  });
  it('rejects malformed, expired, remote or incompatible information', () => {
    for (const data of [
      { ...info, expires_at: 'bad' },
      { ...info, expires_at: '2020-01-01' },
      { ...info, base: 'https://example.com' },
      { ...info, protocol: 2 },
      { ...info, code: '' },
    ]) {
      expect(() => pairingInfo(JSON.stringify(data), now)).toThrow();
    }
    expect(() => pairingInfo('not json', now)).toThrow('完整连接信息');
  });
});

describe('authenticated connection health', () => {
  it('does not treat a stored credential as proof of connection', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    expect(await connectionState(connection, request)).toBe('offline');
    expect(await connectionState(undefined, request)).toBe('unpaired');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('requires the expected protocol and paired installation', async () => {
    const request = respond({ protocol: 1, installation_id: connection.installation });
    expect(await connectionState(connection, request)).toBe('connected');
    expect(request).toHaveBeenCalledWith(
      `${connection.base}/api/v1/connection`,
      expect.objectContaining({
        headers: { Authorization: `Bearer ${connection.token}` },
        redirect: 'error',
        cache: 'no-store',
      }),
    );
    expect(
      await connectionState(connection, respond({ protocol: 1, installation_id: 'another' })),
    ).toBe('incompatible');
    expect(
      await connectionState(
        connection,
        respond({ protocol: 2, installation_id: connection.installation }),
      ),
    ).toBe('incompatible');
  });
  it('distinguishes revoked credentials, old services and unavailable services', async () => {
    expect(await connectionState(connection, respond({}, 401))).toBe('expired');
    expect(await connectionState(connection, respond({}, 403))).toBe('expired');
    expect(await connectionState(connection, respond({}, 404))).toBe('incompatible');
    expect(await connectionState(connection, respond({}, 503))).toBe('offline');
  });
  it('never sends stored tokens to a non-loopback destination', async () => {
    const request = respond({});
    expect(await connectionState({ ...connection, base: 'https://example.com' }, request)).toBe(
      'incompatible',
    );
    expect(request).not.toHaveBeenCalled();
  });
});
